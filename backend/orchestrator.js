'use strict';

/**
 * orchestrator.js — deterministic check runner for the main /api/analyze path.
 *
 * Pipeline:
 *   1. loadClientData(clientId, period)  — pull all entities once via tools.js
 *   2. buildContext(data)                — index maps + entity joins
 *   3. runAllChecks(context)             — per-record + period-level passes
 *        → { findings[], okCheckIds[] }
 *
 * Findings are produced ENTIRELY by deterministic code (checks.js / checks_aggregate.js).
 * The LLM (agent.js → explainFindings) only phrases them in German. It never decides
 * what is wrong.
 *
 * Finding shape (from checks.js `finding()`):
 *   { check_id, severity, affected[], rule_reference, computed }
 */

const { executeTool } = require('./tools');
const checks = require('./checks');
const { runAggregateChecks } = require('./checks_aggregate');

// ---------------------------------------------------------------------------
// Check metadata — fallback English titles for ok_checks and for findings when
// the LLM phrasing step is skipped/unavailable. Extended per phase.
// ---------------------------------------------------------------------------

const CHECK_META = {
  'A-01':      { title: 'Invoice ↔ transaction amount match' },
  'A-02':      { title: 'Invoice ↔ entry VAT rate match' },
  'A-05':      { title: 'Kleinunternehmer outgoing invoice without VAT' },
  'A-06':      { title: 'Regelbesteuerer 0% outgoing invoice has a valid reason' },
  'A-09':      { title: 'Invoice document matches stored data' },
  'A-10':      { title: 'Refund booked with the correct entry type' },
  'A-11':      { title: 'Marketplace fee booked as a separate expense' },
  'A-12':      { title: 'EU supplier Reverse Charge applied correctly' },
  'A-13':      { title: 'No duplicate invoices' },
  'A-15':      { title: 'Document age vs. posting date' },
  'B-01':      { title: 'Vehicle operating costs backed by a vehicle asset' },
  'B-05':      { title: 'No Vorsteuer on Kleinunternehmer invoice' },
  'B-08':      { title: 'Private deposits/withdrawals fit the legal form' },
  'B-09':      { title: 'Expenses typical for the line of business' },
  'B-Cat-01':  { title: 'SKR-04 account code matches the expense' },
  'B-Kfz-01':  { title: 'Vehicle repair matches the usage regime' },
  'B-Type-01': { title: 'EU B2B service uses Reverse Charge (§13b)' },
  'B-ZM-01':   { title: 'EU B2B invoice has a customer VAT ID' },
  'B-02':      { title: 'Depreciation period matches AfA-Tabellen' },
  'B-03':      { title: 'Asset has a linked purchase transaction' },
  'B-EÜR-01':  { title: 'Company car 1%-Regel monthly accruals present' },
  'B-EÜR-02':  { title: 'Asset above GWG threshold is capitalised' },
  'B-EÜR-03':  { title: 'Asset account code has a matching asset' },
  'B-ZM-02':   { title: 'EU B2B invoice carries the Reverse-Charge note' },
  'B-04':      { title: 'Home Office Pauschale not mixed with office costs' },
  'B-06':      { title: 'Phone/Internet split between business and private' },
  'B-07':      { title: 'Pendlerpauschale consistent with work location' },
  'B-UStVA-01':{ title: 'Vorsteuer/Revenue ratio within norms' },
  'B-UStVA-02':{ title: 'Revenue stable vs. prior periods' },
  'C-01':      { title: 'Kleinunternehmer claims no input VAT' },
  'C-02':      { title: 'Revenue within Kleinunternehmer thresholds' },
  'C-04':      { title: 'UStVA filing frequency matches the law' },
  'C-08':      { title: 'Revenue within EÜR/Bilanzierung limits' },
  'C-09':      { title: 'VAT status matches invoice behaviour' },
  'E-01':      { title: 'Consistent private-use splits across categories' },
  'E-02':      { title: 'Plausible private-use share' },
  'E-03':      { title: 'Bewirtung within industry norms' },
  'E-04':      { title: 'Stable private-use splits over time' },
  'E-05':      { title: 'Expense ratios within industry norms' },
  'E-06':      { title: 'No round-sum estimation pattern' },
  'E-07':      { title: 'Expected paired records present' },
  'E-08':      { title: 'No year-end expense spike' },
  'E-09':      { title: 'No unverified bidirectional payments' },
  'E-10':      { title: 'Mixed-use categories not claimed 100% business' },
};

// The set of check IDs the orchestrator runs in the main path (A-09 is booking-only).
// ok_checks = these minus the IDs that produced a finding.
const ACTIVE_CHECK_IDS = [
  'A-01', 'A-02', 'A-05', 'A-06', 'A-10', 'A-11', 'A-12', 'A-13', 'A-15',
  'B-01', 'B-05', 'B-08', 'B-09', 'B-Cat-01', 'B-Kfz-01', 'B-Type-01', 'B-ZM-01',
  'B-02', 'B-03', 'B-EÜR-01', 'B-EÜR-02', 'B-EÜR-03', 'B-ZM-02',
  'B-04', 'B-06', 'B-07', 'B-UStVA-01', 'B-UStVA-02',
  'C-01', 'C-02', 'C-04', 'C-08', 'C-09',
  'E-01', 'E-02', 'E-03', 'E-04', 'E-05', 'E-06', 'E-07', 'E-08', 'E-09', 'E-10',
];

// ---------------------------------------------------------------------------
// 1. Load all client data once
// ---------------------------------------------------------------------------

async function loadClientData(clientId, period) {
  if (!clientId) throw new Error('clientId is required');

  const safe = async (name, input, key, fallback) => {
    try {
      const res = await executeTool(name, input);
      return res[key] ?? fallback;
    } catch (err) {
      // company_settings / business_context throw when missing — degrade gracefully
      return fallback;
    }
  };

  const [company, business_context, transactions, invoices, entries, assets,
         reports_eur, reports_ustva, reports_zm, reports_gewst] = await Promise.all([
    safe('get_company_settings',   { company_id: clientId },          'company_settings',    null),
    safe('get_business_context',   { company_id: clientId },          'business_context',    null),
    safe('get_transactions',       { company_id: clientId, period },  'transactions',        []),
    safe('get_invoices',           { company_id: clientId, period },  'invoices',            []),
    safe('get_bookkeeping_entries',{ company_id: clientId, period },  'bookkeeping_entries', []),
    safe('get_assets',             { company_id: clientId },          'assets',              []),
    safe('get_reports_eur',        { company_id: clientId },          'reports_eur',         []),
    safe('get_reports_ustva',      { company_id: clientId },          'reports_ustva',       []),
    safe('get_reports_zm',         { company_id: clientId },          'reports_zm',          []),
    safe('get_reports_gewst',      { company_id: clientId },          'reports_gewst',       []),
  ]);

  return {
    clientId, period,
    company, business_context,
    transactions, invoices, entries, assets,
    reports_eur, reports_ustva, reports_zm, reports_gewst,
  };
}

// ---------------------------------------------------------------------------
// 2. Build context — index maps for fast joins
// ---------------------------------------------------------------------------

function indexById(rows) {
  const map = Object.create(null);
  for (const r of rows ?? []) if (r && r.id) map[r.id] = r;
  return map;
}

function buildContext(data) {
  return {
    ...data,
    invById:    indexById(data.invoices),
    txById:     indexById(data.transactions),
    entryById:  indexById(data.entries),
    assetById:  indexById(data.assets),
  };
}

// ---------------------------------------------------------------------------
// 3. Run all checks
// ---------------------------------------------------------------------------

function push(arr, finding) {
  if (finding) arr.push(finding);
}

// De-duplicate findings by check_id + sorted affected list
function dedupe(findings) {
  const seen = new Set();
  const out = [];
  for (const f of findings) {
    const key = `${f.check_id}|${[...(f.affected ?? [])].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function runPerRecordChecks(ctx) {
  const { company, business_context, invoices, transactions, entries, assets, invById, txById } = ctx;
  const findings = [];

  // Track which transactions are marketplace settlements flagged by A-11 so the
  // generic amount-mismatch check (A-01) does not double-report the same gap.
  const a11Transactions = new Set();

  // --- Invoice-centric checks ---
  for (const invoice of invoices) {
    const transaction = invoice.linked_transaction_id ? txById[invoice.linked_transaction_id] : null;
    push(findings, checks.checkA05(company, invoice));
    push(findings, checks.checkA06(company, invoice));
    push(findings, checks.checkBZM01(invoice));
    push(findings, checks.checkBZM02(invoice));
    push(findings, checks.checkA15(invoice, transaction));

    // A-11 first (it explains the amount gap); record the transaction it covers
    const a11 = checks.checkA11(invoice, transaction, entries, business_context);
    if (a11) {
      findings.push(a11);
      if (transaction?.id) a11Transactions.add(transaction.id);
    }
    // A-01 only if A-11 did not already explain this settlement's gap
    if (!(transaction && a11Transactions.has(transaction.id))) {
      push(findings, checks.checkA01(invoice, transaction));
    }
  }

  // --- Transaction-centric checks ---
  for (const transaction of transactions) {
    // A-10: refund detection — resolve the linked entry (entry → transaction link)
    const entry = entries.find(e => e.linked_transaction_id === transaction.id) ?? null;
    push(findings, checks.checkA10(transaction, entry));
  }

  // --- Entry-centric checks ---
  for (const entry of entries) {
    const invoice = entry.linked_invoice_id ? invById[entry.linked_invoice_id] : null;
    push(findings, checks.checkA02(invoice, entry));
    push(findings, checks.checkA12(invoice, entry));
    push(findings, checks.checkB05(invoice, entry));
    push(findings, checks.checkB08(entry, company));
    push(findings, checks.checkB09(entry, company));
    push(findings, checks.checkBCat01(entry, invoice));
    push(findings, checks.checkBType01(invoice, entry, business_context));
    push(findings, checks.checkB01(entry, assets));
    push(findings, checks.checkBKfz01(entry, assets, entries));
    push(findings, checks.checkBEUR02(entry, assets));
    push(findings, checks.checkBEUR03(entry, assets));
  }

  // --- Asset-centric checks ---
  for (const asset of assets) {
    push(findings, checks.checkB02(asset));
    push(findings, checks.checkB03(asset, transactions, entries));
  }

  // --- Collection-level (still per-record semantics) ---
  for (const f of checks.findDuplicateInvoices(invoices)) findings.push(f);

  return findings;
}

function runAllChecks(data) {
  const ctx = buildContext(data);

  let findings = [];
  findings = findings.concat(runPerRecordChecks(ctx));
  findings = findings.concat(runAggregateChecks(data));

  findings = dedupe(findings);

  // ok_checks = active checks that ran and produced no finding
  const triggered = new Set(findings.map(f => f.check_id));
  const okCheckIds = ACTIVE_CHECK_IDS.filter(id => !triggered.has(id));

  return { findings, okCheckIds };
}

module.exports = {
  loadClientData,
  buildContext,
  runAllChecks,
  CHECK_META,
  ACTIVE_CHECK_IDS,
};
