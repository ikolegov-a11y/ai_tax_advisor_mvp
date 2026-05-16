'use strict';

/**
 * Phase 1 test script — verifies all tool functions work correctly.
 * Run: node backend/test_tools.js
 * Expected: all lines print [PASS].
 */

const { executeTool, parsePeriod } = require('./tools');

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`[PASS] ${label}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${label}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

// ---------------------------------------------------------------------------
// Period parser
// ---------------------------------------------------------------------------

async function testParsePeriod() {
  await test('parsePeriod: Q1 2026', () => {
    const r = parsePeriod('Q1 2026');
    assert(r.start === '2026-01-01', `start=${r.start}`);
    assert(r.end   === '2026-03-31', `end=${r.end}`);
  });

  await test('parsePeriod: Q4 2025', () => {
    const r = parsePeriod('Q4 2025');
    assert(r.start === '2025-10-01', `start=${r.start}`);
    assert(r.end   === '2025-12-31', `end=${r.end}`);
  });

  await test('parsePeriod: Q1-Q2 2026', () => {
    const r = parsePeriod('Q1-Q2 2026');
    assert(r.start === '2026-01-01', `start=${r.start}`);
    assert(r.end   === '2026-06-30', `end=${r.end}`);
  });

  await test('parsePeriod: Full Year 2025', () => {
    const r = parsePeriod('Full Year 2025');
    assert(r.start === '2025-01-01', `start=${r.start}`);
    assert(r.end   === '2025-12-31', `end=${r.end}`);
  });

  await test('parsePeriod: YYYY-MM', () => {
    const r = parsePeriod('2026-02');
    assert(r.start === '2026-02-01', `start=${r.start}`);
    assert(r.end   === '2026-02-28', `end=${r.end}`);
  });

  await test('parsePeriod: explicit { start, end } passthrough', () => {
    const r = parsePeriod({ start: '2026-01-15', end: '2026-01-31' });
    assert(r.start === '2026-01-15');
    assert(r.end   === '2026-01-31');
  });
}

// ---------------------------------------------------------------------------
// get_transactions
// ---------------------------------------------------------------------------

async function testTransactions() {
  await test('get_transactions: client_001 Q1 2026 — returns records', async () => {
    const { transactions } = await executeTool('get_transactions', {
      company_id: 'client_001',
      period: 'Q1 2026'
    });
    assert(Array.isArray(transactions), 'transactions is not an array');
    assert(transactions.length > 0, 'no transactions found for client_001 Q1 2026');
    assert(transactions.every(t => t.client_id === 'client_001'), 'foreign client_id in results');
  });

  await test('get_transactions: all records in date range', async () => {
    const { transactions } = await executeTool('get_transactions', {
      company_id: 'client_001',
      period: 'Q1 2026'
    });
    transactions.forEach(t => {
      assert(t.date >= '2026-01-01' && t.date <= '2026-03-31',
        `Transaction ${t.id} date ${t.date} outside Q1 2026`);
    });
  });

  await test('get_transactions: type is "incoming" or "outgoing" only', async () => {
    const { transactions } = await executeTool('get_transactions', { company_id: 'client_001' });
    transactions.forEach(t => {
      assert(['incoming', 'outgoing'].includes(t.type),
        `Transaction ${t.id} has invalid type: "${t.type}"`);
    });
  });

  await test('get_transactions: no vat_amount or net_amount in records', async () => {
    const { transactions } = await executeTool('get_transactions', { company_id: 'client_001' });
    transactions.forEach(t => {
      assert(!('vat_amount' in t), `Transaction ${t.id} has forbidden field vat_amount`);
      assert(!('net_amount' in t), `Transaction ${t.id} has forbidden field net_amount`);
    });
  });

  await test('get_transactions: no period returns records', async () => {
    const { transactions } = await executeTool('get_transactions', { company_id: 'client_002' });
    assert(Array.isArray(transactions));
    assert(transactions.length > 0, 'expected records for client_002 with no period filter');
  });

  await test('get_transactions: unknown client returns empty array', async () => {
    const { transactions } = await executeTool('get_transactions', { company_id: 'client_999' });
    assert(transactions.length === 0, 'expected empty array for unknown client');
  });
}

// ---------------------------------------------------------------------------
// get_invoices
// ---------------------------------------------------------------------------

async function testInvoices() {
  await test('get_invoices: client_001 — returns invoices', async () => {
    const { invoices } = await executeTool('get_invoices', { company_id: 'client_001' });
    assert(Array.isArray(invoices));
    assert(invoices.length > 0, 'no invoices found');
  });

  await test('get_invoices: records have file_available field', async () => {
    const { invoices } = await executeTool('get_invoices', { company_id: 'client_001' });
    invoices.forEach(i => {
      assert('file_available' in i, `Invoice ${i.id} missing file_available field`);
    });
  });

  await test('get_invoices: inv_001_006 is OpenAI IE invoice (Reverse Charge test case)', async () => {
    const { invoices } = await executeTool('get_invoices', { company_id: 'client_001' });
    const rc = invoices.find(i => i.id === 'inv_001_006');
    assert(rc, 'inv_001_006 not found');
    assert(rc.supplier_country === 'IE', `Expected IE, got ${rc.supplier_country}`);
    assert(rc.vat_rate === 0.00, `Expected 0.00 VAT, got ${rc.vat_rate}`);
  });

  await test('get_invoices: period filter works', async () => {
    const { invoices } = await executeTool('get_invoices', {
      company_id: 'client_001',
      period: 'Q1 2026'
    });
    invoices.forEach(i => {
      assert(i.date >= '2026-01-01' && i.date <= '2026-03-31',
        `Invoice ${i.id} date ${i.date} outside Q1 2026`);
    });
  });
}

// ---------------------------------------------------------------------------
// get_company_settings
// ---------------------------------------------------------------------------

async function testCompanySettings() {
  await test('get_company_settings: client_001 — Kleinunternehmer', async () => {
    const { company_settings } = await executeTool('get_company_settings', { company_id: 'client_001' });
    assert(company_settings.vat_status === 'Kleinunternehmer',
      `Expected Kleinunternehmer, got ${company_settings.vat_status}`);
    assert(company_settings.vat_id === null, 'Kleinunternehmer should have null vat_id');
  });

  await test('get_company_settings: client_003 — Regelbesteuerer, Gewerbesteuer required', async () => {
    const { company_settings } = await executeTool('get_company_settings', { company_id: 'client_003' });
    assert(company_settings.vat_status === 'Regelbesteuerer',
      `Expected Regelbesteuerer, got ${company_settings.vat_status}`);
    assert(company_settings.gewst_required === true, 'client_003 should have gewst_required=true');
  });

  await test('get_company_settings: throws for unknown client', async () => {
    let threw = false;
    try {
      await executeTool('get_company_settings', { company_id: 'client_999' });
    } catch {
      threw = true;
    }
    assert(threw, 'expected error for unknown client');
  });
}

// ---------------------------------------------------------------------------
// get_business_context
// ---------------------------------------------------------------------------

async function testBusinessContext() {
  await test('get_business_context: client_002 — works_from_home true', async () => {
    const { business_context } = await executeTool('get_business_context', { company_id: 'client_002' });
    assert(business_context.works_from_home === true, 'client_002 should work from home');
  });

  await test('get_business_context: client_004 — has_company_car true', async () => {
    const { business_context } = await executeTool('get_business_context', { company_id: 'client_004' });
    assert(business_context.has_company_car === true, 'client_004 should have a company car');
  });
}

// ---------------------------------------------------------------------------
// get_assets
// ---------------------------------------------------------------------------

async function testAssets() {
  await test('get_assets: client_001 — returns assets', async () => {
    const { assets } = await executeTool('get_assets', { company_id: 'client_001' });
    assert(Array.isArray(assets));
    assert(assets.length > 0, 'no assets found for client_001');
  });

  await test('get_assets: client_001 MacBook has amortization_period_years', async () => {
    const { assets } = await executeTool('get_assets', { company_id: 'client_001' });
    const mac = assets.find(a => /macbook/i.test(a.name));
    assert(mac, 'MacBook asset not found');
    assert(typeof mac.amortization_period_years === 'number',
      'amortization_period_years missing or not a number');
  });

  await test('get_assets: client_004 — BMW vehicle asset present', async () => {
    const { assets } = await executeTool('get_assets', { company_id: 'client_004' });
    const car = assets.find(a => a.is_vehicle === true);
    assert(car, 'No vehicle asset found for client_004');
  });
}

// ---------------------------------------------------------------------------
// get_bookkeeping_entries
// ---------------------------------------------------------------------------

async function testBookkeepingEntries() {
  await test('get_bookkeeping_entries: client_001 — returns entries', async () => {
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', {
      company_id: 'client_001'
    });
    assert(Array.isArray(bookkeeping_entries));
    assert(bookkeeping_entries.length > 0, 'no bookkeeping entries for client_001');
  });

  await test('get_bookkeeping_entries: all entries have required new fields', async () => {
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', {
      company_id: 'client_001'
    });
    bookkeeping_entries.forEach(e => {
      assert('reverse_charge_flag' in e,  `${e.id} missing reverse_charge_flag`);
      assert('service_type' in e,         `${e.id} missing service_type`);
      assert('vat_rate_if_domestic' in e, `${e.id} missing vat_rate_if_domestic`);
      assert('counterparty_name' in e,    `${e.id} missing counterparty_name`);
    });
  });

  await test('get_bookkeeping_entries: entry_001_009 has domestic treatment (test case #1 — incorrect)', async () => {
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', {
      company_id: 'client_001'
    });
    const e = bookkeeping_entries.find(e => e.id === 'entry_001_009');
    assert(e, 'entry_001_009 not found');
    assert(e.tax_residency_applied === 'domestic',
      `Expected domestic, got ${e.tax_residency_applied}`);
    assert(e.reverse_charge_flag === false,
      `Expected false, got ${e.reverse_charge_flag}`);
    assert(e.vat_rate === 0.19, `Expected 0.19, got ${e.vat_rate}`);
  });

  await test('get_bookkeeping_entries: client_002 has 2025 cleaning entries (test case #2)', async () => {
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', {
      company_id: 'client_002'
    });
    const cleaning = bookkeeping_entries.filter(e => e.account_code === '6330');
    assert(cleaning.length > 0, 'No 6330 (Büroreinigung) entries found for client_002');
  });

  await test('get_bookkeeping_entries: period filter works', async () => {
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', {
      company_id: 'client_001',
      period: 'Q1 2026'
    });
    bookkeeping_entries.forEach(e => {
      assert(e.date >= '2026-01-01' && e.date <= '2026-03-31',
        `Entry ${e.id} date ${e.date} outside Q1 2026`);
    });
  });
}

// ---------------------------------------------------------------------------
// get_reports_*
// ---------------------------------------------------------------------------

async function testReports() {
  await test('get_reports_eur: client_002 has tagespauschale (test case #2)', async () => {
    const { reports_eur } = await executeTool('get_reports_eur', {
      company_id: 'client_002',
      year: 2025
    });
    assert(reports_eur.length > 0, 'No EÜR 2025 report for client_002');
    const r = reports_eur[0];
    assert(r.home_office?.method === 'tagespauschale',
      `Expected tagespauschale, got ${r.home_office?.method}`);
  });

  await test('get_reports_ustva: client_003 has monthly reports', async () => {
    const { reports_ustva } = await executeTool('get_reports_ustva', { company_id: 'client_003' });
    assert(reports_ustva.length > 0, 'No UStVA reports found for client_003');
  });

  await test('get_reports_ustva: period filter by month', async () => {
    const { reports_ustva } = await executeTool('get_reports_ustva', {
      company_id: 'client_003',
      period: '2026-03'
    });
    assert(reports_ustva.length === 1, `Expected 1 record, got ${reports_ustva.length}`);
    assert(reports_ustva[0].period === '2026-03');
  });

  await test('get_reports_zm: client_006 has ZM report', async () => {
    const { reports_zm } = await executeTool('get_reports_zm', { company_id: 'client_006' });
    assert(reports_zm.length > 0, 'No ZM reports for client_006');
  });

  await test('get_reports_gewst: client_003 has Gewerbesteuer report', async () => {
    const { reports_gewst } = await executeTool('get_reports_gewst', {
      company_id: 'client_003',
      year: 2025
    });
    assert(reports_gewst.length > 0, 'No GewSt report for client_003');
  });

  await test('get_reports_gewst: clients without Gewerbesteuer return empty', async () => {
    const { reports_gewst } = await executeTool('get_reports_gewst', { company_id: 'client_001' });
    assert(reports_gewst.length === 0, 'client_001 should have no GewSt report');
  });
}

// ---------------------------------------------------------------------------
// get_tasks
// ---------------------------------------------------------------------------

async function testTasks() {
  await test('get_tasks: client_001 — returns tasks', async () => {
    const { tasks } = await executeTool('get_tasks', { company_id: 'client_001' });
    assert(Array.isArray(tasks));
    assert(tasks.length > 0, 'no tasks for client_001');
  });

  await test('get_tasks: all 7 clients have at least one task', async () => {
    const clients = ['client_001','client_002','client_003','client_004',
                     'client_005','client_006','client_007'];
    for (const cid of clients) {
      const { tasks } = await executeTool('get_tasks', { company_id: cid });
      assert(tasks.length > 0, `No tasks for ${cid}`);
    }
  });
}

// ---------------------------------------------------------------------------
// recognize_invoice_document (file_not_available path)
// ---------------------------------------------------------------------------

async function testRecognizeInvoice() {
  await test('recognize_invoice_document: file_not_available → recognized=false, no error', async () => {
    // All test invoices have file_available=false except inv_001_006 which has a PDF
    const result = await executeTool('recognize_invoice_document', { invoice_id: 'inv_001_001' });
    assert(result.recognized === false, 'expected recognized=false');
    assert(result.reason === 'file_not_available', `reason=${result.reason}`);
    assert(result.fields === null, 'fields should be null when file unavailable');
  });
}

// ---------------------------------------------------------------------------
// categorize_invoice
// ---------------------------------------------------------------------------

async function testCategorizeInvoice() {
  await test('categorize_invoice: inv_001_006 — Reverse Charge software subscription', async () => {
    const result = await executeTool('categorize_invoice', {
      invoice_id: 'inv_001_006',
      line_items: ['ChatGPT Plus subscription — monthly']
    });
    assert(result.suggested_account_code === '4980',
      `Expected 4980, got ${result.suggested_account_code}`);
    assert(result.reverse_charge_applicable === true,
      'Expected reverse_charge_applicable=true');
    assert(result.vat_rate_if_domestic === 0.19,
      `Expected 0.19, got ${result.vat_rate_if_domestic}`);
    assert(result.confidence >= 0.9, `Low confidence: ${result.confidence}`);
  });

  await test('categorize_invoice: unknown invoice — returns confidence=0, no error', async () => {
    const result = await executeTool('categorize_invoice', {
      invoice_id: 'inv_999_999',
      line_items: []
    });
    assert(result.confidence === 0, 'expected confidence=0 for unknown invoice');
    assert(result.suggested_account_code === null);
  });
}

// ---------------------------------------------------------------------------
// Cross-entity consistency — test case #1 (Reverse Charge error)
// ---------------------------------------------------------------------------

async function testReverseChargeTestCase() {
  await test('Test Case #1: entry_001_009 contradicts inv_001_006 (Reverse Charge error)', async () => {
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', { company_id: 'client_001' });
    const { invoices }            = await executeTool('get_invoices', { company_id: 'client_001' });

    const entry   = bookkeeping_entries.find(e => e.id === 'entry_001_009');
    const invoice = invoices.find(i => i.id === 'inv_001_006');

    assert(entry,   'entry_001_009 not found');
    assert(invoice, 'inv_001_006 not found');

    // The contradiction: entry says domestic 19%, but invoice supplier is IE with 0% VAT
    const entryIsWrong = (
      entry.tax_residency_applied === 'domestic' &&
      entry.reverse_charge_flag   === false       &&
      invoice.supplier_country    === 'IE'        &&
      invoice.vat_rate            === 0.00
    );

    assert(entryIsWrong,
      'Expected contradiction between entry_001_009 (domestic, no RC) and inv_001_006 (IE, 0%)'
    );
  });
}

// ---------------------------------------------------------------------------
// Cross-entity consistency — test case #2 (Home Office)
// ---------------------------------------------------------------------------

async function testHomeOfficeTestCase() {
  await test('Test Case #2: client_002 EÜR tagespauschale contradicts 6330 entries', async () => {
    const { reports_eur }         = await executeTool('get_reports_eur', { company_id: 'client_002', year: 2025 });
    const { bookkeeping_entries } = await executeTool('get_bookkeeping_entries', { company_id: 'client_002' });

    const eur2025   = reports_eur.find(r => r.year === 2025);
    const cleaning  = bookkeeping_entries.filter(e => e.account_code === '6330' &&
                                                       e.date.startsWith('2025'));

    assert(eur2025,            'EÜR 2025 not found for client_002');
    assert(cleaning.length > 0,'No 6330 cleaning entries in 2025 for client_002');
    assert(eur2025.home_office.method === 'tagespauschale',
      `Expected tagespauschale, got ${eur2025.home_office.method}`);

    // Contradiction is detectable: tagespauschale + 6330 expense in the same year
    // (Tagespauschale covers all home office costs — separate Reinigung deduction is wrong)
    const contradictionDetectable = eur2025.home_office.method === 'tagespauschale' &&
                                    cleaning.length > 0;
    assert(contradictionDetectable, 'Expected detectable contradiction for test case #2');
  });
}

// ---------------------------------------------------------------------------
// executeTool: unknown tool name
// ---------------------------------------------------------------------------

async function testDispatcher() {
  await test('executeTool: unknown tool name throws', async () => {
    let threw = false;
    try {
      await executeTool('nonexistent_tool', {});
    } catch {
      threw = true;
    }
    assert(threw, 'expected error for unknown tool');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log('=== Phase 1: tools.js verification ===\n');

  await testParsePeriod();
  await testTransactions();
  await testInvoices();
  await testCompanySettings();
  await testBusinessContext();
  await testAssets();
  await testBookkeepingEntries();
  await testReports();
  await testTasks();
  await testRecognizeInvoice();
  await testCategorizeInvoice();
  await testReverseChargeTestCase();
  await testHomeOfficeTestCase();
  await testDispatcher();

  console.log(`\n${'='.repeat(42)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nPhase 1 FAILED — fix issues before proceeding to Phase 2.');
    process.exit(1);
  } else {
    console.log('\nPhase 1 PASSED — ready for Phase 2 (agent.js).');
  }
})();
