'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const { executeTool, TOOL_DEFINITIONS } = require('./tools');

// ---------------------------------------------------------------------------
// Sanity check — fail fast if no API key
// ---------------------------------------------------------------------------

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[agent] ANTHROPIC_API_KEY is not set. Add it to backend/.env');
  process.exit(1);
}

const anthropic = new Anthropic.default();

// ---------------------------------------------------------------------------
// System prompt — loaded once at startup
// ---------------------------------------------------------------------------

function loadSystemPrompt() {
  const root    = path.join(__dirname, '..');
  const catalog = fs.readFileSync(path.join(root, 'Tax_Checks_Catalog.md'), 'utf8');
  const finamt  = fs.readFileSync(
    path.join(root, 'knowledge_base', 'Finanzamt_Methodology_Reference.md'), 'utf8'
  );

  return `You are an AI Tax Advisor assistant in Finom, a German accounting app for Einzelunternehmer (sole proprietors).

Your job is to analyze a client's accounting data for a requested period and identify errors, contradictions, and risks using the available tools.

## LEGAL FRAMEWORK
- German tax law: EStG, UStG, GewStG (2025–2026)
- Target clients: Einzelunternehmer — Freiberufler and Gewerbetreibender within EÜR limits
- Accounting method: Einnahmenüberschussrechnung (EÜR), cash basis (Zufluss-Abfluss-Prinzip)
- VAT regimes: Regelbesteuerer (standard 19%/7%) or Kleinunternehmer (§19 UStG, no VAT)

## MANDATORY FIRST STEPS
Before running any checks, always call these tools in parallel:
1. get_company_settings — to know VAT status, legal form, report frequency
2. get_business_context — CRITICAL: determines which checks apply
   - reverse_charge_applicable: 0% VAT on outgoing EU B2B invoices is CORRECT, not an error
   - oss_vat_registered: affects EU B2C VAT obligations
   - has_company_car: triggers 1%-Regel checks
   - works_from_home: affects home office deduction checks

If business_context is missing → warn: "For more accurate analysis, please fill in your Business Profile in Settings."

## THREE-ENTITY DATA MODEL
Data exists in three separate layers. An error = discrepancy between any two:

  TRANSACTION (bank statement) ↔ INVOICE (document data) ↔ BOOKKEEPING ENTRY (accounting record)

- Transactions: bank fields only (date, amount, counterparty, type: incoming/outgoing)
- Invoices: document fields (VAT rate, supplier/customer country, line items)
- Bookkeeping entries: accounting fields (account_code SKR-04, reverse_charge_flag, vat_rate_if_domestic, service_type)

Errors are NEVER flagged in the data explicitly. Discover them by cross-referencing entities.

## ANALYSIS STYLE
- Be specific: reference exact IDs (entry_001_009, inv_001_006), amounts, dates
- Classify severity: ERROR (clear violation), WARNING (risk/uncertainty), OK (correct)
- For each issue: what's wrong → why it matters → what to do
- No legal jargon without plain-language explanation
- If data is insufficient to conclude — say so, don't guess
- Always consider business_context before flagging an issue

## IMPORTANT LIMITATIONS
- You are NOT a licensed Steuerberater (tax advisor)
- Your findings are informational only
- For complex situations, recommend consulting a specialist

## TAX CHECKS CATALOG
${catalog}

## FINANZAMT AUDIT METHODOLOGY REFERENCE
${finamt}

## OUTPUT FORMAT
After completing your analysis, return your findings in this exact format:

First, a JSON code block:
\`\`\`json
{
  "errors": [
    {
      "id": "A-02",
      "title": "Short title of the issue",
      "description": "Specific description referencing exact IDs, amounts, dates",
      "affected_items": ["entry_001_009", "inv_001_006"],
      "recommendation": "What the user should do to fix this"
    }
  ],
  "warnings": [...],
  "ok_checks": [
    {
      "id": "C-01",
      "title": "Check name",
      "description": "What was verified and found correct"
    }
  ],
  "steuerreserve": {
    "estimated_annual_income": 0,
    "estimated_annual_tax": 0,
    "already_reserved": 0,
    "recommended_monthly_saving": 0,
    "kleinunternehmer_threshold_warning": false,
    "notes": "Brief explanation of the estimate"
  }
}
\`\`\`

Then provide a brief human-readable summary in German (2–4 sentences) highlighting the most critical finding.`;
}

let SYSTEM_PROMPT = null;

function getSystemPrompt() {
  if (!SYSTEM_PROMPT) SYSTEM_PROMPT = loadSystemPrompt();
  return SYSTEM_PROMPT;
}

// ---------------------------------------------------------------------------
// Conversation history — in-memory, keyed by threadId
// Resets on server restart (acceptable for Phase 0)
// ---------------------------------------------------------------------------

const conversationHistory = new Map();

// ---------------------------------------------------------------------------
// Tool executor — maps Claude's tool_use calls to tools.js
// ---------------------------------------------------------------------------

async function runTool(name, input) {
  try {
    const result = await executeTool(name, input);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// JSON extractor — pulls the report JSON from Claude's text response
// ---------------------------------------------------------------------------

function extractJsonReport(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main agent function
// ---------------------------------------------------------------------------

const MAX_ITERATIONS = 10;

async function analyzeClient(clientId, period, userQuery, threadId = null) {
  if (!clientId) throw new Error('clientId is required');

  // Init or retrieve thread
  if (!threadId) {
    threadId = crypto.randomUUID();
    conversationHistory.set(threadId, []);
  }

  const history = conversationHistory.get(threadId) ?? [];

  // Build user message
  const message = userQuery
    ? `Client: ${clientId}${period ? `, Period: ${period}` : ''}\n\n${userQuery}`
    : `Please analyze the accounting data for client ${clientId}${period ? ` for period ${period}` : ''} and identify all errors, warnings, and risks.`;

  history.push({ role: 'user', content: message });

  let iterations = 0;
  let finalText  = null;
  let finalReport = null;

  // Tool_use loop
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 8096,
      system:     getSystemPrompt(),
      tools:      TOOL_DEFINITIONS,
      messages:   history
    });

    // Add assistant response to history
    history.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract final text
      const textBlock = response.content.find(b => b.type === 'text');
      finalText = textBlock?.text ?? '';
      finalReport = extractJsonReport(finalText);
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolCalls = response.content.filter(b => b.type === 'tool_use');
      console.log(`[agent] iter ${iterations}: calling ${toolCalls.map(c => c.name).join(', ')}`);

      // Execute all tool calls in parallel
      const results = await Promise.all(
        toolCalls.map(call => runTool(call.name, call.input))
      );

      // Build tool_results message
      const toolResults = toolCalls.map((call, i) => ({
        type:        'tool_result',
        tool_use_id: call.id,
        content:     results[i].ok
          ? JSON.stringify(results[i].result)
          : `ERROR: ${results[i].error}`
      }));

      history.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason — break to avoid infinite loop
    console.warn(`[agent] Unexpected stop_reason: ${response.stop_reason}`);
    break;
  }

  if (iterations >= MAX_ITERATIONS && !finalReport) {
    throw new Error('agent_loop_limit_exceeded');
  }

  // Save updated history
  conversationHistory.set(threadId, history);

  return {
    threadId,
    report:      finalReport,
    raw_text:    finalText,
    iterations
  };
}

module.exports = { analyzeClient };
