'use strict';

/**
 * steuerreserve.js — deterministic tax-reserve estimate (no LLM math).
 *
 * Pipeline:
 *   1. Annualize taxable profit  = (income_net − deductible_expense_net) × 12 / N_months
 *   2. Einkommensteuer via the statutory §32a EStG 2025 progressive scale
 *      (anchored to Tax_Rules_Reference.md: Grundfreibetrag €12.096, top rate from €68.430)
 *   3. Solidaritätszuschlag — 5.5% above the SolZG Freigrenze (€18.130 ESt), with Milderungszone
 *   4. Gewerbesteuer — only for Gewerbetreibende (Freibetrag €24.500, Hebesatz default 400%)
 *   5. Recommended monthly saving = total annual tax / 12
 *
 * v1 (PRD BA-9): do NOT compare with an "already reserved" amount.
 */

const { monthsInPeriod } = require('./checks_aggregate');

// ---- TRR anchors ----------------------------------------------------------
const GRUNDFREIBETRAG   = 12096;   // §32a Abs. 1 EStG (TRR)
const TOP_RATE_FROM      = 68430;  // §32a — Spitzensteuersatz start (TRR)
const SOLI_FREIGRENZE    = 18130;  // §3 Abs. 3 SolZG — ESt Freigrenze (TRR)
const GEWST_FREIBETRAG   = 24500;  // §11 Abs. 1 GewStG (TRR)
const GEWST_MESSZAHL     = 0.035;  // §11 Abs. 2 GewStG
const GEWST_HEBESATZ     = 4.0;    // default 400% (municipal; ~average)
const SOLI_RATE          = 0.055;
const KU_CEILING         = 100000; // §19 UStG current-year ceiling

// ---------------------------------------------------------------------------
// §32a EStG 2025 — Einkommensteuer (Grundtarif). zvE = taxable income (rounded down).
// Zones consistent with the TRR Grundfreibetrag / top-rate anchors.
// ---------------------------------------------------------------------------
function einkommensteuer(zvE) {
  const x = Math.floor(Math.max(0, zvE));
  if (x <= GRUNDFREIBETRAG) return 0;

  if (x <= 17443) {
    const y = (x - GRUNDFREIBETRAG) / 10000;
    return round2((932.30 * y + 1400) * y);
  }
  if (x <= TOP_RATE_FROM) {
    const z = (x - 17443) / 10000;
    return round2((176.64 * z + 2397) * z + 1015.13);
  }
  if (x <= 277825) {
    return round2(0.42 * x - 10911.92);
  }
  return round2(0.45 * x - 19246.67);
}

// Solidaritätszuschlag with Milderungszone (Einzelveranlagung).
function solidaritaetszuschlag(est) {
  if (est <= SOLI_FREIGRENZE) return 0;
  const full      = SOLI_RATE * est;
  const milderung = 0.119 * (est - SOLI_FREIGRENZE); // 11.9% gleitende Zone
  return round2(Math.min(full, milderung));
}

// Gewerbesteuer — only for Gewerbetreibende.
function gewerbesteuer(profit, isGewerbe) {
  if (!isGewerbe) return 0;
  const base = Math.max(0, Math.floor(profit) - GEWST_FREIBETRAG);
  if (base <= 0) return 0;
  return round2(base * GEWST_MESSZAHL * GEWST_HEBESATZ);
}

function round2(n) { return Math.round(n * 100) / 100; }
function isIncome(e)  { return e.type === 'income'; }
function isExpense(e) { return e.type === 'expense'; }
function sum(arr, fn) { return arr.reduce((s, x) => s + (fn(x) || 0), 0); }

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------
function calculateSteuerreserve(data) {
  const { company, entries = [], period } = data ?? {};
  const months = monthsInPeriod(period);
  const n = months ? months.length : 12;
  const factor = n > 0 ? 12 / n : 1;

  const incomeNet  = sum(entries.filter(isIncome),  e => e.amount_net ?? e.amount_gross);
  const expenseNet = sum(entries.filter(isExpense), e => e.amount_net ?? e.amount_gross);
  const periodProfit = incomeNet - expenseNet;

  const annualIncome  = round2(incomeNet * factor);          // turnover (for KU threshold)
  const annualProfit  = round2(Math.max(0, periodProfit) * factor); // taxable base

  const isGewerbe = /gewerbe/i.test(String(company?.legal_form ?? '')) || company?.gewst_required === true;

  const est   = einkommensteuer(annualProfit);
  const soli  = solidaritaetszuschlag(est);
  const gewst = gewerbesteuer(annualProfit, isGewerbe);
  const totalTax = round2(est + soli + gewst);

  const isKU = String(company?.vat_status) === 'Kleinunternehmer';
  const kuWarning = isKU && annualIncome > KU_CEILING;

  return {
    estimated_annual_income:    annualProfit,           // taxable profit basis
    estimated_annual_turnover:  annualIncome,           // gross turnover (info)
    estimated_annual_tax:       totalTax,
    breakdown: {
      einkommensteuer:        est,
      solidaritaetszuschlag:  soli,
      gewerbesteuer:          gewst,
    },
    recommended_monthly_saving: round2(totalTax / 12),
    kleinunternehmer_threshold_warning: kuWarning,
    notes: `Schätzung auf Basis von ${n} Monat(en), annualisiert (×${round2(factor)}). ` +
           `Profit (Einnahmen−Ausgaben) annualisiert: ${annualProfit} €. ${isGewerbe ? 'Inkl. Gewerbesteuer (Hebesatz 400%). ' : 'Freiberufler — keine Gewerbesteuer. '}` +
           `Ohne Berücksichtigung von Sonderausgaben/Freibeträgen — für eine genaue Berechnung Steuerberater konsultieren.`,
  };
}

module.exports = { calculateSteuerreserve, einkommensteuer, solidaritaetszuschlag, gewerbesteuer };
