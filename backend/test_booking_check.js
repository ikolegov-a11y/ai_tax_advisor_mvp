'use strict';

/**
 * test_booking_check.js — unit tests for checks.js
 * Run: node backend/test_booking_check.js
 * No test framework — plain Node.js assertions.
 */

const { runBuchungspruefung } = require('./checks');

let passed = 0;
let failed = 0;

function assert(label, actual, expectFn) {
  try {
    expectFn(actual);
    console.log(`✅  ${label}`);
    passed++;
  } catch (e) {
    console.error(`❌  ${label}: ${e.message}`);
    failed++;
  }
}

function findingWithId(findings, check_id) {
  return findings.find(f => f.check_id === check_id) ?? null;
}

// ---------------------------------------------------------------------------
// Scenario 1: A-01 — Invoice amount €4500, transaction amount €4300 → ERROR
// ---------------------------------------------------------------------------
assert('A-01: amount mismatch (diff €200) → ERROR', (() => {
  return runBuchungspruefung({
    invoice:     { id: 'inv_test_1', type: 'incoming', amount_gross: 4500, vat_rate: 0.19 },
    transaction: { id: 'txn_test_1', amount: 4300 },
  });
})(), findings => {
  const f = findingWithId(findings, 'A-01');
  if (!f)                       throw new Error('A-01 not found in findings');
  if (f.severity !== 'ERROR')   throw new Error(`Expected ERROR, got ${f.severity}`);
  if (f.computed.diff !== 200)  throw new Error(`Expected diff=200, got ${f.computed.diff}`);
});

// ---------------------------------------------------------------------------
// Scenario 2: A-02 — Invoice vat_rate 0.19, entry vat_rate 0.00 → ERROR
// ---------------------------------------------------------------------------
assert('A-02: VAT rate mismatch (invoice 19%, entry 0%) → ERROR', (() => {
  return runBuchungspruefung({
    invoice: { id: 'inv_test_2', type: 'incoming', vat_rate: 0.19, amount_gross: 1190 },
    entry:   { id: 'entry_test_2', vat_rate: 0.00 },
  });
})(), findings => {
  const f = findingWithId(findings, 'A-02');
  if (!f)                     throw new Error('A-02 not found in findings');
  if (f.severity !== 'ERROR') throw new Error(`Expected ERROR, got ${f.severity}`);
});

// ---------------------------------------------------------------------------
// Scenario 3: A-05 — Kleinunternehmer + outgoing invoice vat_rate 0.19 → ERROR
// ---------------------------------------------------------------------------
assert('A-05: Kleinunternehmer issues invoice with 19% VAT → ERROR', (() => {
  return runBuchungspruefung({
    company: { client_id: 'test', vat_status: 'Kleinunternehmer' },
    invoice: { id: 'inv_test_3', type: 'outgoing', vat_rate: 0.19, amount_gross: 595 },
  });
})(), findings => {
  const f = findingWithId(findings, 'A-05');
  if (!f)                     throw new Error('A-05 not found in findings');
  if (f.severity !== 'ERROR') throw new Error(`Expected ERROR, got ${f.severity}`);
});

// ---------------------------------------------------------------------------
// Scenario 4: A-12 — EU supplier (IE), RC not applied, entry vat_rate > 0 → ERROR
// ---------------------------------------------------------------------------
assert('A-12: EU supplier (IE), reverse_charge_flag=false, vat_rate_if_domestic=0.19 → ERROR', (() => {
  return runBuchungspruefung({
    invoice: { id: 'inv_test_4', type: 'incoming', supplier_country: 'IE', vat_rate: 0, amount_gross: 50 },
    entry:   { id: 'entry_test_4', reverse_charge_flag: false, vat_rate_if_domestic: 0.19, vat_rate: 0.19 },
  });
})(), findings => {
  const f = findingWithId(findings, 'A-12');
  if (!f)                     throw new Error('A-12 not found in findings');
  if (f.severity !== 'ERROR') throw new Error(`Expected ERROR, got ${f.severity}`);
  if (f.computed.supplier_country !== 'IE') throw new Error(`Expected supplier_country=IE, got ${f.computed.supplier_country}`);
});

// ---------------------------------------------------------------------------
// Scenario 5: CLEAN — Regelbesteuerer, domestic DE supplier, matching VAT → empty findings
// ---------------------------------------------------------------------------
assert('CLEAN: Regelbesteuerer, DE supplier, invoice vat=0.19, entry vat=0.19 → no findings', (() => {
  return runBuchungspruefung({
    company: { client_id: 'test', vat_status: 'Regelbesteuerer' },
    invoice: {
      id: 'inv_test_5', type: 'incoming',
      supplier_country: 'DE', vat_rate: 0.19, amount_gross: 1190, amount_net: 1000,
    },
    transaction: { id: 'txn_test_5', amount: 1190 },
    entry: {
      id: 'entry_test_5', vat_rate: 0.19,
      reverse_charge_flag: false, account_code: '6815',
    },
  });
})(), findings => {
  if (findings.length !== 0) {
    throw new Error(`Expected 0 findings, got ${findings.length}: ${findings.map(f => f.check_id).join(', ')}`);
  }
});

// ---------------------------------------------------------------------------
// Scenario 6: B-Cat-01 — account_code 6650 (Reisekosten) + description "Restaurant" → WARNING
// ---------------------------------------------------------------------------
assert('B-Cat-01: SKR04 6650 + description "Restaurant Berlin" → WARNING', (() => {
  return runBuchungspruefung({
    entry:   { id: 'entry_test_6', account_code: '6650', description: 'Geschäftsessen Restaurant Berlin', amount_net: 85 },
    invoice: { id: 'inv_test_6',  type: 'incoming', vat_rate: 0.19, amount_gross: 101.15 },
  });
})(), findings => {
  const f = findingWithId(findings, 'B-Cat-01');
  if (!f)                       throw new Error('B-Cat-01 not found in findings');
  if (f.severity !== 'WARNING') throw new Error(`Expected WARNING, got ${f.severity}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
