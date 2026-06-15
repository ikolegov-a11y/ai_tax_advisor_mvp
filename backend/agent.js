'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const crypto    = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const { loadClientData, runAllChecks, CHECK_META } = require('./orchestrator');
const { calculateSteuerreserve } = require('./steuerreserve');

// ---------------------------------------------------------------------------
// Anthropic client — created lazily at first call so module init never crashes
// ---------------------------------------------------------------------------

let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Add it to the project-root .env or Railway env vars.');
    }
    _anthropic = new Anthropic.default();
  }
  return _anthropic;
}

// ---------------------------------------------------------------------------
// Retry helper — handles 429 rate-limit errors with exponential backoff
// ---------------------------------------------------------------------------

async function withRetry(fn, maxAttempts = 4, baseDelayMs = 15000) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429 || String(err?.message).includes('rate_limit');
      if (!is429 || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * attempt;
      console.warn(`[agent] Rate limit hit (attempt ${attempt}/${maxAttempts}). Retrying in ${delay / 1000}s…`);
      await new Promise(r => setTimeout(r, delay));
      lastError = err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Conversation store — keyed by threadId. Holds the deterministic analysis so
// chat follow-up questions are answered OVER the fixed findings (the LLM never
// re-decides what is wrong).
// Resets on server restart (acceptable for Phase 0).
// ---------------------------------------------------------------------------

const conversationStore = new Map(); // threadId -> { data, findings, report, messages: [] }

// ---------------------------------------------------------------------------
// Robust JSON extraction from an LLM text response
// ---------------------------------------------------------------------------

function extractJson(text) {
  if (!text) return null;
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fenced.length ? fenced.map(m => m[1]) : [text];
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(candidates[i].trim());
    } catch { /* try next */ }
  }
  // last resort: first {...} span
  const span = text.match(/\{[\s\S]*\}/);
  if (span) { try { return JSON.parse(span[0]); } catch { /* ignore */ } }
  return null;
}

// ---------------------------------------------------------------------------
// LLM phrasing — turns deterministic findings into German title/description/
// recommendation text. The LLM is given the COMPUTED findings; it only writes
// the human-readable wording, never decides severity or what is affected.
// ---------------------------------------------------------------------------

const PHRASING_SYSTEM = `Du bist ein Buchungsprüfer in Finom, einem deutschen Buchhaltungsprogramm für Einzelunternehmer (EÜR, §EStG/UStG/GewStG).
Eine automatische, deterministische Prüfung hat bereits ENTSCHIEDEN, welche Befunde vorliegen. Deine Aufgabe ist NUR, jeden Befund verständlich auf Deutsch zu formulieren.
Du darfst NICHT entscheiden, ob etwas ein Fehler ist, und keine neuen Befunde erfinden. Verwende ausschließlich die gelieferten Daten (IDs, Beträge, Regelreferenz).

Für jeden Befund liefere:
- title: kurze Überschrift (max. 8 Wörter)
- description: was konkret nicht stimmt — mit exakten IDs/Beträgen/Sätzen aus computed
- recommendation: konkrete Handlungsempfehlung in 1–2 Sätzen

Gib AUSSCHLIESSLICH gültiges JSON zurück, keine Markdown-Codeblöcke:
{ "items": [ { "ref": <number>, "title": "...", "description": "...", "recommendation": "..." } ], "summary": "2–4 Sätze auf Deutsch zum kritischsten Befund" }
Behalte jede "ref"-Nummer exakt bei. Liefere genau so viele items wie Befunde geliefert wurden.`;

async function phraseFindings(findings, data) {
  const company = data.company ?? {};
  const ctxLine = `Mandant: ${data.clientId} | Rechtsform: ${company.legal_form ?? '–'} | USt-Status: ${company.vat_status ?? '–'} | Zeitraum: ${data.period ?? 'alle'}`;

  const numbered = findings.map((f, i) => ({
    ref:            i,
    check_id:       f.check_id,
    severity:       f.severity,
    rule_reference: f.rule_reference,
    affected:       f.affected,
    computed:       f.computed,
  }));

  const userMessage = `${ctxLine}\n\nBefunde (deterministisch berechnet, JSON):\n${JSON.stringify(numbered, null, 2)}`;

  const response = await withRetry(() => getAnthropicClient().messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 4096,
    system:     PHRASING_SYSTEM,
    messages:   [{ role: 'user', content: userMessage }],
  }));

  const text   = response.content.find(b => b.type === 'text')?.text ?? '';
  const parsed = extractJson(text) ?? {};
  const byRef  = new Map((parsed.items ?? []).map(it => [Number(it.ref), it]));

  return { byRef, summary: parsed.summary ?? '' };
}

// ---------------------------------------------------------------------------
// Assemble the final report in the shape the frontend + tests expect:
//   { errors[], warnings[], ok_checks[], steuerreserve }
//   each finding item: { id, title, description, affected_items[], recommendation, severity }
// id === check_id so test_all_clients.js can match expected IDs.
// ---------------------------------------------------------------------------

function toReportItem(finding, ref, byRef) {
  const phrased  = byRef?.get(ref) ?? {};
  const fallback = CHECK_META[finding.check_id]?.title ?? finding.check_id;
  return {
    id:             finding.check_id,
    severity:       finding.severity,
    title:          phrased.title       || fallback,
    description:    phrased.description  || `${finding.rule_reference ?? ''} — ${JSON.stringify(finding.computed ?? {})}`.trim(),
    affected_items: finding.affected ?? [],
    recommendation: phrased.recommendation || '',
    rule_reference: finding.rule_reference,
  };
}

function assembleReport(findings, byRef, okCheckIds, steuerreserve) {
  const errors   = [];
  const warnings = [];

  findings.forEach((f, ref) => {
    const item = toReportItem(f, ref, byRef);
    if (f.severity === 'ERROR') errors.push(item);
    else warnings.push(item); // WARNING + INFO both surface under warnings (tagged via severity)
  });

  const ok_checks = (okCheckIds ?? []).map(id => ({
    id,
    title: CHECK_META[id]?.title ?? id,
  }));

  return { errors, warnings, ok_checks, steuerreserve: steuerreserve ?? null };
}

// ---------------------------------------------------------------------------
// Chat follow-up — answers a user question over the ALREADY-computed findings.
// ---------------------------------------------------------------------------

const FOLLOWUP_SYSTEM = `Du bist ein AI-Steuerassistent in Finom für Einzelunternehmer.
Eine deterministische Prüfung der Buchhaltung wurde bereits durchgeführt; die Befunde stehen fest.
Beantworte die Rückfrage des Nutzers AUSSCHLIESSLICH auf Basis der bereitgestellten Befunde und Daten.
Erfinde keine neuen Fehler und ändere keine Schweregrade. Antworte auf Deutsch, präzise, mit konkreten IDs/Beträgen.`;

async function answerFollowup(store, userQuery) {
  const findingsJson = JSON.stringify(store.findings ?? [], null, 2);
  const messages = [
    { role: 'user', content: `Vorliegende Befunde (JSON):\n${findingsJson}\n\nRückfrage des Nutzers:\n${userQuery}` },
  ];
  const response = await withRetry(() => getAnthropicClient().messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1500,
    system:     FOLLOWUP_SYSTEM,
    messages,
  }));
  return response.content.find(b => b.type === 'text')?.text ?? '';
}

// ---------------------------------------------------------------------------
// Main entry point — deterministic analysis, LLM only phrases.
// ---------------------------------------------------------------------------

async function analyzeClient(clientId, period, userQuery, threadId = null) {
  if (!clientId) throw new Error('clientId is required');

  // Chat follow-up: a thread already analyzed → answer over fixed findings.
  if (threadId && conversationStore.has(threadId)) {
    const store = conversationStore.get(threadId);
    if (store.report) {
      const answer = await answerFollowup(store, userQuery ?? '');
      return { threadId, report: store.report, raw_text: answer, iterations: 0 };
    }
  }

  if (!threadId) threadId = crypto.randomUUID();

  // 1–3. Deterministic findings
  const data = await loadClientData(clientId, period);
  const { findings, okCheckIds } = runAllChecks(data);

  // 4. Steuerreserve — deterministic calculation (no LLM math)
  let steuerreserve = null;
  try {
    steuerreserve = calculateSteuerreserve(data);
  } catch (err) {
    console.error('[agent] steuerreserve calculation failed:', err.message);
  }

  // 5. LLM phrasing (skipped when there are no findings)
  let byRef = null, summary = 'Keine Fehler oder Auffälligkeiten in den geprüften Buchungen gefunden.';
  if (findings.length > 0) {
    try {
      const phrased = await phraseFindings(findings, data);
      byRef   = phrased.byRef;
      summary = phrased.summary || summary;
    } catch (err) {
      console.error('[agent] phrasing failed, using deterministic fallback:', err.message);
    }
  }

  // 6. Assemble
  const report = assembleReport(findings, byRef, okCheckIds, steuerreserve);

  conversationStore.set(threadId, { data, findings, report });

  return { threadId, report, raw_text: summary, iterations: 0 };
}

module.exports = { analyzeClient };
