'use strict';

/**
 * Unit tests for the deterministic Steuerreserve calculator (no API).
 * Run: node backend/test_steuerreserve.js
 */

const { einkommensteuer, solidaritaetszuschlag, gewerbesteuer, calculateSteuerreserve } = require('./steuerreserve');

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { console.log(`✅  ${label}`); passed++; }
  else { console.error(`❌  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function approx(a, b, tol = 1) { return Math.abs(a - b) <= tol; }

// --- §32a EStG 2025 reference points ---
assert('ESt below Grundfreibetrag is 0', einkommensteuer(12000) === 0);
assert('ESt at 12096 is 0', einkommensteuer(12096) === 0);
assert('ESt(20000) ≈ 1640', approx(einkommensteuer(20000), 1640, 30), `got ${einkommensteuer(20000)}`);
assert('ESt(48000) ≈ 9990', approx(einkommensteuer(48000), 9990, 80), `got ${einkommensteuer(48000)}`);
assert('ESt(80000) top zone ≈ 22688', approx(einkommensteuer(80000), 22688, 80), `got ${einkommensteuer(80000)}`);
assert('ESt is monotonic', einkommensteuer(50000) > einkommensteuer(40000));

// --- Solidaritätszuschlag ---
assert('Soli 0 when ESt below Freigrenze', solidaritaetszuschlag(15000) === 0);
assert('Soli applies above Freigrenze', solidaritaetszuschlag(40000) > 0);

// --- Gewerbesteuer ---
assert('GewSt 0 for non-Gewerbe', gewerbesteuer(100000, false) === 0);
assert('GewSt 0 below Freibetrag', gewerbesteuer(20000, true) === 0);
assert('GewSt applies above Freibetrag', gewerbesteuer(100000, true) > 0);

// --- Full calculation: Freiberufler, Q1 only, ~4000/month profit ---
const freelancer = calculateSteuerreserve({
  company: { legal_form: 'Freiberufler', vat_status: 'Kleinunternehmer' },
  period: 'Q1 2026',
  entries: [
    { type: 'income',  amount_net: 12000 },  // Q1 income
    { type: 'expense', amount_net: 3000  },   // Q1 expenses
  ],
});
// annual profit ≈ (12000-3000) × 4 = 36000
assert('annual profit annualized to ~36000', approx(freelancer.estimated_annual_income, 36000, 1), JSON.stringify(freelancer.estimated_annual_income));
assert('freelancer has no Gewerbesteuer', freelancer.breakdown.gewerbesteuer === 0);
assert('monthly saving > 0', freelancer.recommended_monthly_saving > 0);
assert('monthly = annual_tax/12', approx(freelancer.recommended_monthly_saving, freelancer.estimated_annual_tax / 12, 0.5));

// --- Gewerbetreibender gets Gewerbesteuer ---
const gewerbe = calculateSteuerreserve({
  company: { legal_form: 'Gewerbetreibender', gewst_required: true, vat_status: 'Regelbesteuerer' },
  period: 'Q1 2026',
  entries: [ { type: 'income', amount_net: 30000 }, { type: 'expense', amount_net: 5000 } ],
});
assert('Gewerbetreibender has Gewerbesteuer > 0', gewerbe.breakdown.gewerbesteuer > 0, JSON.stringify(gewerbe.breakdown));

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
