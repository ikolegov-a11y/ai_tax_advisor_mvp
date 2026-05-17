'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR          = path.join(__dirname, 'data');
const INVOICE_FILES_DIR = path.join(DATA_DIR, 'invoice_files');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8'));
}

/**
 * Parse a human-readable period string into { start, end } ISO date strings.
 * Accepts: "Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026",
 *          "Q1-Q2 2026", "Q1-Q3 2026", "Q1-Q4 2026",
 *          "Full Year 2026", or an explicit { start, end } object.
 */
function parsePeriod(period) {
  if (!period) return null;

  if (typeof period === 'object' && period.start && period.end) {
    return period;
  }

  const str = String(period).trim();

  // "Full Year YYYY"
  const fullYear = str.match(/^Full Year (\d{4})$/i);
  if (fullYear) {
    const y = fullYear[1];
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }

  // "Q1-Q4 YYYY" range
  const qRange = str.match(/^Q(\d)-Q(\d) (\d{4})$/i);
  if (qRange) {
    const [, q1, q2, y] = qRange;
    const quarterStart = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
    const quarterEnd   = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
    return { start: `${y}-${quarterStart[q1]}`, end: `${y}-${quarterEnd[q2]}` };
  }

  // "Q1 YYYY"
  const single = str.match(/^Q(\d) (\d{4})$/i);
  if (single) {
    const [, q, y] = single;
    const quarterStart = { 1: '01-01', 2: '04-01', 3: '07-01', 4: '10-01' };
    const quarterEnd   = { 1: '03-31', 2: '06-30', 3: '09-30', 4: '12-31' };
    return { start: `${y}-${quarterStart[q]}`, end: `${y}-${quarterEnd[q]}` };
  }

  // "YYYY-MM" (single month)
  const month = str.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const [, y, m] = month;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
  }

  throw new Error(`Unrecognized period format: "${period}". ` +
    'Use "Q1 2026", "Q1-Q2 2026", "Full Year 2026", or { start, end }.');
}

function inRange(dateStr, range) {
  if (!range) return true;
  return dateStr >= range.start && dateStr <= range.end;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * get_transactions
 * Returns bank transactions for a client, optionally filtered by period.
 * If period is omitted, returns all records (agent decides what to do with them).
 */
function get_transactions({ company_id, period }) {
  if (!company_id) throw new Error('company_id is required');
  const range = period ? parsePeriod(period) : null;
  const all   = readJson('transactions.json');
  const rows  = all.filter(t => t.client_id === company_id && inRange(t.date, range));
  return { transactions: rows };
}

/**
 * get_invoices
 * Returns invoices (outgoing + incoming) for a client, optionally filtered by period.
 */
function get_invoices({ company_id, period }) {
  if (!company_id) throw new Error('company_id is required');
  const range = period ? parsePeriod(period) : null;
  const all   = readJson('invoices.json');
  const rows  = all.filter(i => i.client_id === company_id && inRange(i.date, range));
  return { invoices: rows };
}

/**
 * get_company_settings
 * Returns static company configuration: legal form, VAT status, tax numbers, etc.
 */
function get_company_settings({ company_id }) {
  if (!company_id) throw new Error('company_id is required');
  const settings = readJson('company_settings.json').find(s => s.client_id === company_id);
  if (!settings) throw new Error(`No company_settings found for ${company_id}`);
  return { company_settings: settings };
}

/**
 * get_business_context
 * Returns business model context: sales channels, geography, home office, car, etc.
 * Must be loaded before running any tax checks.
 */
function get_business_context({ company_id }) {
  if (!company_id) throw new Error('company_id is required');
  const ctx = readJson('business_context.json').find(c => c.client_id === company_id);
  if (!ctx) throw new Error(`No business_context found for ${company_id}`);
  return { business_context: ctx };
}

/**
 * get_assets
 * Returns all fixed assets for a client (no date filter — full list always needed).
 */
function get_assets({ company_id }) {
  if (!company_id) throw new Error('company_id is required');
  const all  = readJson('assets.json');
  const rows = all.filter(a => a.client_id === company_id);
  return { assets: rows };
}

/**
 * get_bookkeeping_entries
 * Returns accounting entries for a client, optionally filtered by period.
 */
function get_bookkeeping_entries({ company_id, period }) {
  if (!company_id) throw new Error('company_id is required');
  const range = period ? parsePeriod(period) : null;
  const all   = readJson('bookkeeping_entries.json');
  const rows  = all.filter(e => e.client_id === company_id && inRange(e.date, range));
  return { bookkeeping_entries: rows };
}

/**
 * get_reports_eur
 * Returns EÜR annual reports for a client, optionally filtered by year.
 */
function get_reports_eur({ company_id, year }) {
  if (!company_id) throw new Error('company_id is required');
  const all  = readJson('reports_eur.json');
  const rows = all.filter(r =>
    r.client_id === company_id && (!year || r.year === Number(year))
  );
  return { reports_eur: rows };
}

/**
 * get_reports_ustva
 * Returns UStVA (VAT return) reports for a client, optionally filtered by period string.
 * period examples: "2026-01", "2026-Q1"
 */
function get_reports_ustva({ company_id, period }) {
  if (!company_id) throw new Error('company_id is required');
  const all  = readJson('reports_ustva.json');
  const rows = all.filter(r => {
    if (r.client_id !== company_id) return false;
    if (!period) return true;
    return r.period === period;
  });
  return { reports_ustva: rows };
}

/**
 * get_reports_zm
 * Returns Zusammenfassende Meldung (EU summary reports) for a client.
 */
function get_reports_zm({ company_id, period }) {
  if (!company_id) throw new Error('company_id is required');
  const all  = readJson('reports_zm.json');
  const rows = all.filter(r => {
    if (r.client_id !== company_id) return false;
    if (!period) return true;
    return r.period === period;
  });
  return { reports_zm: rows };
}

/**
 * get_reports_gewst
 * Returns Gewerbesteuer annual reports for a client.
 */
function get_reports_gewst({ company_id, year }) {
  if (!company_id) throw new Error('company_id is required');
  const all  = readJson('reports_gewst.json');
  const rows = all.filter(r =>
    r.client_id === company_id && (!year || r.year === Number(year))
  );
  return { reports_gewst: rows };
}

/**
 * get_tasks
 * Returns all tasks for a client (pending, in_progress, completed).
 */
function get_tasks({ company_id }) {
  if (!company_id) throw new Error('company_id is required');
  const all  = readJson('tasks.json');
  const rows = all.filter(t => t.client_id === company_id);
  return { tasks: rows };
}

/**
 * recognize_invoice_document
 * Reads an invoice PDF and returns extracted fields via Claude Vision.
 * In Phase 0: uses a real API call if file_available == true.
 * Falls back to null result if file not found (do NOT fabricate data).
 */
async function recognize_invoice_document({ invoice_id, company_id }) {
  if (!invoice_id) throw new Error('invoice_id is required');

  // Look up the invoice to get company_id if not provided
  const invoices = readJson('invoices.json');
  const invoice  = invoices.find(i => i.id === invoice_id);
  if (!invoice) throw new Error(`Invoice not found: ${invoice_id}`);

  const clientId = company_id || invoice.client_id;

  if (!invoice.file_available) {
    return {
      invoice_id,
      recognized: false,
      reason: 'file_not_available',
      fields: null
    };
  }

  const filePath = path.join(INVOICE_FILES_DIR, clientId, `${invoice_id}.pdf`);
  if (!fs.existsSync(filePath)) {
    return {
      invoice_id,
      recognized: false,
      reason: 'file_not_found_on_disk',
      fields: null
    };
  }

  // Load Anthropic SDK lazily — only needed if a real PDF is present
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default();

  const pdfData = fs.readFileSync(filePath);
  const base64  = pdfData.toString('base64');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 }
        },
        {
          type: 'text',
          text: `Extract the following fields from this invoice and return ONLY valid JSON (no markdown):
{
  "invoice_number": string,
  "date": "YYYY-MM-DD",
  "amount_gross": number,
  "amount_net": number,
  "vat_rate": number,
  "vat_amount": number,
  "currency": string,
  "supplier_name": string,
  "supplier_vat_id": string | null,
  "supplier_country": string,
  "line_items": [string]
}
If a field is not present on the document, use null.`
        }
      ]
    }]
  });

  let fields = null;
  try {
    const text = response.content.find(b => b.type === 'text')?.text ?? '';
    fields = JSON.parse(text.trim());
  } catch {
    return { invoice_id, recognized: false, reason: 'parse_error', fields: null };
  }

  return { invoice_id, recognized: true, fields };
}

/**
 * get_expense_categories
 * Returns the full production expense category list.
 * Each category has: id, group_title (de/en), category_title (de/en),
 * category_description (de/en), skr04, skr03, type.
 * Use to validate account_code in bookkeeping entries, or to suggest
 * the correct SKR-04 code when the agent detects a miscategorization.
 */
function get_expense_categories({ group, skr04 } = {}) {
  const all = readJson('expense_categories.json');
  let rows = all;

  if (group) {
    const g = group.toLowerCase();
    rows = rows.filter(c =>
      c.group_title.en.toLowerCase().includes(g) ||
      c.group_title.de.toLowerCase().includes(g)
    );
  }

  if (skr04 !== undefined && skr04 !== null) {
    const code = String(skr04);
    rows = rows.filter(c => String(c.skr04) === code);
  }

  return { expense_categories: rows };
}

/**
 * categorize_invoice
 * Returns suggested SKR-04 account code and VAT/RC metadata for an invoice.
 * In Phase 0: looks up mock data in invoice_categories.json by invoice_id.
 * In production: would call the real categorization service.
 */
function categorize_invoice({ invoice_id, line_items }) {
  if (!invoice_id) throw new Error('invoice_id is required');
  const categories = readJson('invoice_categories.json');
  const match      = categories.find(c => c.invoice_id === invoice_id);

  if (!match) {
    return {
      invoice_id,
      confidence: 0,
      suggested_account_code: null,
      suggested_account_name: null,
      suggested_category: null,
      vat_rate_if_domestic: null,
      reverse_charge_applicable: null,
      service_type: null,
      notes: 'No categorization data found for this invoice (mock)'
    };
  }

  return match;
}

// ---------------------------------------------------------------------------
// Dispatcher — used by agent.js to route tool_use calls
// ---------------------------------------------------------------------------

const TOOL_MAP = {
  get_transactions,
  get_invoices,
  get_company_settings,
  get_business_context,
  get_assets,
  get_bookkeeping_entries,
  get_reports_eur,
  get_reports_ustva,
  get_reports_zm,
  get_reports_gewst,
  get_tasks,
  recognize_invoice_document,
  categorize_invoice,
  get_expense_categories
};

async function executeTool(name, input) {
  const fn = TOOL_MAP[name];
  if (!fn) throw new Error(`Unknown tool: "${name}"`);
  return fn(input);
}

// ---------------------------------------------------------------------------
// Tool definitions for Claude API (tool_use schema)
// ---------------------------------------------------------------------------

const TOOL_DEFINITIONS = [
  {
    name: 'get_transactions',
    description: 'Returns bank transactions for a client. Use to verify cash flows, match against invoices, and check for missing or unlinked payments.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID, e.g. "client_001"' },
        period:     { type: 'string', description: 'Optional. "Q1 2026", "Q1-Q2 2026", "Full Year 2026", or "YYYY-MM". Omit to get all records.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_invoices',
    description: 'Returns outgoing and incoming invoices for a client. Use to verify VAT rates, counterparty countries, and invoice ↔ bookkeeping entry consistency.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' },
        period:     { type: 'string', description: 'Optional period filter.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_company_settings',
    description: 'Returns static company configuration: legal form, VAT status (Regelbesteuerer / Kleinunternehmer), VAT ID, tax number, report frequency, Gewerbesteuer obligation.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_business_context',
    description: 'Returns business model context: sales channels, client geography, whether Reverse Charge applies, OSS registration, home office setup, company car details. MUST be loaded before running any tax checks.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_assets',
    description: 'Returns all fixed assets: equipment, vehicles, software. Use to verify depreciation periods (AfA), 1%-Regel for company cars, GWG threshold.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_bookkeeping_entries',
    description: 'Returns accounting entries (income, expense, depreciation, private use). Each entry includes account_code (SKR-04), reverse_charge_flag, service_type, vat_rate_if_domestic, and links to transaction and invoice.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' },
        period:     { type: 'string', description: 'Optional period filter.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_reports_eur',
    description: 'Returns EÜR (income-surplus calculation) annual reports. Contains home office method and deduction amounts, revenue/expense totals, filing status.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' },
        year:       { type: 'number', description: 'Optional. Filter by year, e.g. 2025.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_reports_ustva',
    description: 'Returns UStVA (VAT return) reports for monthly or quarterly periods. Contains Umsatz totals, Vorsteuer, net VAT payable, filing status.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' },
        period:     { type: 'string', description: 'Optional. "2026-01" for January, "2026-Q1" for Q1.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_reports_zm',
    description: 'Returns Zusammenfassende Meldung (EU intra-community supply summary) reports. Contains EU customer VAT IDs and supply amounts.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' },
        period:     { type: 'string', description: 'Optional period filter.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_reports_gewst',
    description: 'Returns Gewerbesteuer (trade tax) annual reports. Contains Gewerbeertrag, Freibetrag, payable amount. Only relevant for Gewerbetreibende.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' },
        year:       { type: 'number', description: 'Optional. Filter by year.' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'get_tasks',
    description: 'Returns all open and completed tasks for a client: report submission deadlines, bookkeeping fixes, review actions.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Client ID' }
      },
      required: ['company_id']
    }
  },
  {
    name: 'recognize_invoice_document',
    description: 'Reads an invoice PDF and extracts fields (amount, VAT, supplier, date, line items) using Claude Vision. Only call if invoice.file_available == true.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_id:  { type: 'string', description: 'Invoice ID, e.g. "inv_001_006"' },
        company_id:  { type: 'string', description: 'Client ID (optional if invoice_id is unique)' }
      },
      required: ['invoice_id']
    }
  },
  {
    name: 'get_expense_categories',
    description: 'Returns the full production expense category list (94 categories). Each entry has SKR-04/SKR-03 account codes, group, title (de/en), type (Goods/Services/FinancialAsset). Use to validate whether a bookkeeping entry uses the correct account_code, or to suggest the right code when a miscategorization is detected. Can be filtered by group name or skr04 code.',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Optional. Filter by group name, e.g. "Technology", "Travel", "Vehicle Operation".' },
        skr04: { description: 'Optional. Filter by exact SKR-04 account code, e.g. 6837 or "0135".', oneOf: [{ type: 'number' }, { type: 'string' }] }
      },
      required: []
    }
  },
  {
    name: 'categorize_invoice',
    description: 'Returns suggested SKR-04 account code, VAT rate for domestic purchase, and whether Reverse Charge applies, based on invoice content.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice ID' },
        line_items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Line items from the invoice (from recognize_invoice_document or stored invoice data)'
        }
      },
      required: ['invoice_id']
    }
  }
];

module.exports = { executeTool, TOOL_DEFINITIONS, parsePeriod };
