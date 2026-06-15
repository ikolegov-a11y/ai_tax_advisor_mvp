'use strict';

const fs   = require('fs');
const path = require('path');

const { runBuchungspruefung } = require('./checks');
const { executeTool }         = require('./tools');

const DATA_DIR = path.join(__dirname, 'data');

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

// ---------------------------------------------------------------------------
// Load a single record by id from a JSON array file
// Returns null if not found or if id is falsy
// ---------------------------------------------------------------------------
function findById(filename, id) {
  if (!id) return null;
  const records = readJson(filename);
  return records.find(r => r.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// LLM explanation — called only when findings.length > 0
// ---------------------------------------------------------------------------
async function generateExplanation(findings, invoice, entry) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default();

  const contextSummary = [
    invoice && `Rechnung: ${invoice.id} | Betrag: ${invoice.amount_gross} € | MwSt: ${invoice.vat_rate * 100}% | Typ: ${invoice.type} | Land: ${invoice.supplier_country ?? invoice.customer_country ?? '–'}`,
    entry   && `Buchung: ${entry.id} | MwSt: ${entry.vat_rate ?? '–'} | RC: ${entry.reverse_charge_flag} | SKR04: ${entry.account_code}`,
  ].filter(Boolean).join('\n');

  const systemPrompt = `Du bist ein Buchungsprüfer in Finom, einem deutschen Buchhaltungsprogramm für Einzelunternehmer.
Du hast eine automatische Prüfung der Buchung durchgeführt und Befunde liegen vor.
Erkläre jeden Befund auf Deutsch — klar und verständlich, ohne unnötigen Fachjargon.

Für jeden Befund verwende exakt diese Struktur:

**Was ist falsch:** [Konkret was nicht stimmt — Werte, IDs, Beträge nennen]
**Warum wichtig:** [Steuerliche Konsequenz und Rechtsgrundlage, z.B. §19 UStG, §13b UStG]
**Was tun:** [Konkrete Handlungsempfehlung in 1–2 Sätzen]

Maximal 3–4 Sätze pro Abschnitt. Keine Begrüßung, kein Fazit — nur die strukturierten Befunde.`;

  const userMessage = `Buchungskontext:\n${contextSummary}\n\nBefunde (JSON):\n${JSON.stringify(findings, null, 2)}`;

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 800,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  });

  return response.content.find(b => b.type === 'text')?.text ?? '';
}

// ---------------------------------------------------------------------------
// Main handler — exported and wired into server.js
// ---------------------------------------------------------------------------
async function handleBookingCheck(req, res) {
  const started = Date.now();

  const { client_id, invoice_id, transaction_id, entry_id } = req.body ?? {};

  // Validation
  if (!client_id) {
    return res.status(400).json({ error: 'missing_fields', message: 'client_id is required' });
  }
  if (!invoice_id && !transaction_id && !entry_id) {
    return res.status(400).json({
      error: 'missing_fields',
      message: 'At least one of invoice_id, transaction_id, entry_id is required'
    });
  }

  // Load context from JSON files
  let company, business, invoice, transaction, entry;
  try {
    const settings  = readJson('company_settings.json');
    company         = settings.find(s => s.client_id === client_id) ?? null;
    const contexts  = readJson('business_context.json');
    business        = contexts.find(c => c.client_id === client_id) ?? null;
    invoice         = findById('invoices.json', invoice_id);
    transaction     = findById('transactions.json', transaction_id);
    entry           = findById('bookkeeping_entries.json', entry_id);
  } catch (err) {
    return res.status(500).json({ error: 'data_error', message: err.message });
  }

  if (!company) {
    return res.status(404).json({ error: 'client_not_found', message: `No settings found for "${client_id}"` });
  }

  // Wire invoice document recognition (A-09) — only when a real PDF is attached.
  let recognized_data = null;
  if (invoice && invoice.file_available) {
    try {
      const ocr = await executeTool('recognize_invoice_document', {
        invoice_id: invoice.id,
        company_id: client_id,
      });
      recognized_data = ocr?.recognized ? ocr.fields : null;
    } catch (err) {
      console.warn('[booking-check] OCR failed, skipping A-09:', err.message);
    }
  }

  // Run deterministic checks
  const context  = { company, business_context: business, invoice, transaction, entry, recognized_data };
  const findings = runBuchungspruefung(context);

  const elapsed = Date.now() - started;

  // Clean path — no LLM call
  if (findings.length === 0) {
    if (elapsed > 2000) console.warn(`[booking-check] clean path exceeded 2000ms: ${elapsed}ms`);
    return res.json({ status: 'ok', findings: [] });
  }

  // Issues found — call LLM for explanation
  let explanation = '';
  try {
    explanation = await generateExplanation(findings, invoice, entry);
  } catch (err) {
    console.error('[booking-check] LLM error:', err.message);
    explanation = 'Erklärung konnte nicht generiert werden.';
  }

  const totalElapsed = Date.now() - started;
  console.log(`[booking-check] ${findings.length} finding(s) — ${totalElapsed}ms`);

  return res.json({ status: 'issues_found', findings, explanation });
}

module.exports = { handleBookingCheck };
