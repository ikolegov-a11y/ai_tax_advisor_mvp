'use strict';

/**
 * checks_aggregate.js — period-level / company-level deterministic checks.
 *
 * Unlike checks.js (per-record), these inspect groups of records across the
 * whole requested period: home-office vs office expenses, VAT ratios, VAT-status
 * contradictions, filing-frequency, vehicle 1%-Regel monthly accruals, etc.
 *
 * All thresholds come from Tax_Rules_Reference.md (TRR). Each function returns a
 * findings array (possibly empty). Finding shape matches checks.js `finding()`.
 */

const { parsePeriod } = require('./tools');

function finding(check_id, severity, affected, rule_reference, computed) {
  return { check_id, severity, affected, rule_reference, computed };
}

// ---- TRR thresholds -------------------------------------------------------
const KU_PRIOR_YEAR_LIMIT   = 25000;   // §19 Abs. 1 UStG (prior year)
const KU_CEILING            = 100000;  // §19 current-year ceiling
const KU_WARN_LEVEL         = 80000;   // approaching the ceiling
const USTVA_MONTHLY_MIN     = 9000;    // §18 Abs. 2 UStG (Wachstumschancengesetz 2025)
const USTVA_QUARTERLY_MIN   = 2000;
const VORSTEUER_RATIO_WARN  = 0.40;    // B-UStVA-01 audit-risk ratio
const REVENUE_DEVIATION     = 0.50;    // B-UStVA-02
const BILANZ_REVENUE_WARN   = 700000;  // C-08 approaching €800k
const VEHICLE_1PCT_RE        = /1.?percent|1%|privatnutzung|privatanteil|private use/i;

// ---- helpers --------------------------------------------------------------
function yearOf(dateStr) { return dateStr ? String(dateStr).slice(0, 4) : null; }
function monthsInPeriod(period) {
  const range = period ? parsePeriod(period) : null;
  if (!range) return null;
  const out = [];
  let [y, m] = range.start.split('-').map(Number);
  const [ey, em] = range.end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function isIncome(e)  { return e.type === 'income'; }
function isExpense(e) { return e.type === 'expense'; }
function sum(arr, fn) { return arr.reduce((s, x) => s + (fn(x) || 0), 0); }

// ---------------------------------------------------------------------------
// B-04: Home Office Tagespauschale + office-premises expenses in the same year
// ---------------------------------------------------------------------------
function checkB04(entries, reports_eur) {
  const pauschaleYears = new Set(
    (reports_eur ?? [])
      .filter(r => String(r.home_office?.method ?? '').toLowerCase() === 'tagespauschale')
      .map(r => String(r.year))
  );
  if (pauschaleYears.size === 0) return [];

  const ERROR_CODES = ['6310'];                       // Büromiete — direct contradiction
  const WARN_CODES  = ['6330', '6335', '6345'];       // cleaning / upkeep / room costs
  const offending = (entries ?? []).filter(e =>
    pauschaleYears.has(yearOf(e.date)) &&
    (ERROR_CODES.includes(String(e.account_code)) || WARN_CODES.includes(String(e.account_code)))
  );
  if (offending.length === 0) return [];

  const hasRent = offending.some(e => ERROR_CODES.includes(String(e.account_code)));
  return [finding('B-04', hasRent ? 'ERROR' : 'WARNING',
    offending.map(e => e.id),
    '§4 Abs. 5 Nr. 6b EStG (Home Office)',
    { method: 'tagespauschale', offending_codes: [...new Set(offending.map(e => String(e.account_code)))], total: +sum(offending, e => e.amount_gross).toFixed(2) }
  )];
}

// ---------------------------------------------------------------------------
// B-06: Phone/Internet expenses with no private-use split anywhere
// ---------------------------------------------------------------------------
function checkB06(entries) {
  const phone = (entries ?? []).filter(e =>
    /phone.*internet|telefon|internet/i.test(e.category ?? '') || String(e.account_code) === '4920'
  );
  if (phone.length === 0) return [];
  const anySplit = phone.some(e => (e.private_use_split ?? 0) > 0 || e.is_private_use === true);
  if (anySplit) return [];
  return [finding('B-06', 'WARNING',
    phone.map(e => e.id),
    '§4 Abs. 4 EStG / §12 EStG',
    { count: phone.length, total: +sum(phone, e => e.amount_gross).toFixed(2), note: 'no business/private split' }
  )];
}

// ---------------------------------------------------------------------------
// B-07: Pendlerpauschale claimed while working from home (home == office)
// ---------------------------------------------------------------------------
function checkB07(entries, business_context) {
  const pendler = (entries ?? []).filter(e =>
    /pendlerpauschale|entfernungspauschale/i.test(`${e.category ?? ''} ${e.description ?? ''}`)
  );
  if (pendler.length === 0) return [];
  if (business_context?.works_from_home !== true) return [];
  return [finding('B-07', 'WARNING',
    pendler.map(e => e.id),
    '§9 Abs. 1 Nr. 4 EStG',
    { count: pendler.length, works_from_home: true }
  )];
}

// ---------------------------------------------------------------------------
// B-UStVA-01: Vorsteuer / Revenue ratio above the audit-risk threshold
// ---------------------------------------------------------------------------
function checkBUStVA01(entries) {
  const revenue   = sum((entries ?? []).filter(isIncome),  e => e.amount_net ?? e.amount_gross);
  const vorsteuer = sum((entries ?? []).filter(isExpense), e => e.vat_amount);
  if (revenue <= 0 || vorsteuer <= 0) return [];
  const ratio = vorsteuer / revenue;
  if (ratio <= VORSTEUER_RATIO_WARN) return [];
  return [finding('B-UStVA-01', 'WARNING',
    [],
    '§15 UStG / Finanzamt RMS',
    { vorsteuer: +vorsteuer.toFixed(2), revenue: +revenue.toFixed(2), ratio_pct: +(ratio * 100).toFixed(1), threshold_pct: 40 }
  )];
}

// ---------------------------------------------------------------------------
// B-UStVA-02: Current revenue deviates >50% from the prior 3 periods' average
//   Uses quarterly UStVA history; needs ≥3 prior periods, else skips.
// ---------------------------------------------------------------------------
function checkBUStVA02(reports_ustva, period) {
  const quarterly = (reports_ustva ?? [])
    .filter(r => r.period_type === 'quarterly' && r.period)
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));
  if (quarterly.length < 4) return []; // need current + 3 prior

  const current = quarterly[quarterly.length - 1];
  const prior3  = quarterly.slice(-4, -1);
  const rev = r => (r.total_revenue_taxable_19 ?? 0) + (r.total_revenue_taxable_7 ?? 0);
  const avg = sum(prior3, rev) / prior3.length;
  if (avg <= 0) return [];
  const dev = Math.abs(rev(current) - avg) / avg;
  if (dev <= REVENUE_DEVIATION) return [];
  return [finding('B-UStVA-02', 'INFO',
    [current.id].filter(Boolean),
    'ELSTER RMS',
    { current_revenue: +rev(current).toFixed(2), prior_avg: +avg.toFixed(2), deviation_pct: +(dev * 100).toFixed(1) }
  )];
}

// ---------------------------------------------------------------------------
// B-EÜR-01: Company car (1%-Regel) missing monthly private-use accrual entries
// ---------------------------------------------------------------------------
function checkBEUR01(assets, entries, period) {
  const months = monthsInPeriod(period);
  if (!months) return []; // cannot determine the months to expect

  const out = [];
  const oneePctVehicles = (assets ?? []).filter(a =>
    a.is_vehicle === true && VEHICLE_1PCT_RE.test(String(a.vehicle_details?.private_use_method ?? a.amortization_method ?? ''))
  );

  const privateUseEntries = (entries ?? []).filter(e =>
    String(e.account_code) === '1880' || VEHICLE_1PCT_RE.test(`${e.category ?? ''} ${e.description ?? ''}`)
  );
  const coveredMonths = new Set(privateUseEntries.map(e => String(e.date).slice(0, 7)));

  for (const v of oneePctVehicles) {
    const missing = months.filter(m => !coveredMonths.has(m));
    if (missing.length === 0) continue;
    out.push(finding('B-EÜR-01', 'WARNING',
      [v.id],
      '§6 Abs. 1 Nr. 4 EStG (1%-Regelung)',
      { vehicle: v.name, missing_months: missing, monthly_amount: v.vehicle_details?.monthly_private_use_amount ?? null }
    ));
  }
  return out;
}

// ---------------------------------------------------------------------------
// C-01: Kleinunternehmer claiming input VAT (Vorsteuerabzug)
//   Strong signal: a filed UStVA showing Vorsteuer, or postings to Vorsteuer
//   accounts (1571/1576/1577). Merely recording vat_amount on an expense is NOT
//   enough (KU may store it informationally).
// ---------------------------------------------------------------------------
const VORSTEUER_ACCOUNTS = ['1571', '1576', '1577'];
function checkC01(entries, company, reports_ustva) {
  if (String(company?.vat_status) !== 'Kleinunternehmer') return [];

  const vorsteuerEntries = (entries ?? []).filter(e => VORSTEUER_ACCOUNTS.includes(String(e.account_code)));
  const filedVorsteuer = (reports_ustva ?? []).some(r => (r.total_vorsteuer ?? 0) > 0);
  if (vorsteuerEntries.length === 0 && !filedVorsteuer) return [];

  return [finding('C-01', 'ERROR',
    vorsteuerEntries.map(e => e.id),
    '§19 UStG / §15 UStG',
    { vat_status: 'Kleinunternehmer', vorsteuer_entries: vorsteuerEntries.length, filed_vorsteuer: filedVorsteuer }
  )];
}

// ---------------------------------------------------------------------------
// C-02: Revenue exceeds the Kleinunternehmer thresholds
// ---------------------------------------------------------------------------
function checkC02(entries, company, period, reports_eur) {
  if (String(company?.vat_status) !== 'Kleinunternehmer') return [];

  const months = monthsInPeriod(period);
  const n = months ? months.length : 12;
  const periodRevenue = sum((entries ?? []).filter(isIncome), e => e.amount_net ?? e.amount_gross);
  const annualized = n > 0 ? periodRevenue * (12 / n) : periodRevenue;

  // Prior-year revenue from EÜR reports if present
  const priorYearRevenue = (reports_eur ?? [])
    .map(r => r.total_revenue ?? r.revenue ?? null)
    .filter(v => v != null)
    .sort((a, b) => b - a)[0] ?? null;

  if (priorYearRevenue != null && priorYearRevenue > KU_PRIOR_YEAR_LIMIT) {
    return [finding('C-02', 'ERROR', [],
      '§19 Abs. 1 UStG',
      { prior_year_revenue: priorYearRevenue, limit: KU_PRIOR_YEAR_LIMIT }
    )];
  }
  if (annualized > KU_WARN_LEVEL) {
    return [finding('C-02', 'WARNING', [],
      '§19 Abs. 1 UStG',
      { annualized_revenue: +annualized.toFixed(2), ceiling: KU_CEILING, warn_level: KU_WARN_LEVEL }
    )];
  }
  return [];
}

// ---------------------------------------------------------------------------
// C-04: UStVA filing frequency inconsistent with prior-year Zahllast (§18 Abs. 2)
//   Threshold on the prior-year net VAT payable (Zahllast), NOT collected VAT.
// ---------------------------------------------------------------------------
function checkC04(reports_ustva, company) {
  // Kleinunternehmer file no UStVA — the frequency rule does not apply.
  if (String(company?.vat_status) === 'Kleinunternehmer') return [];

  const annual = (reports_ustva ?? []).find(r => r.period_type === 'annual' && r.net_vat_payable != null);
  if (!annual) return [];
  const zahllast = annual.net_vat_payable;

  let required;
  if (zahllast > USTVA_MONTHLY_MIN)         required = 'monthly';
  else if (zahllast >= USTVA_QUARTERLY_MIN) required = 'quarterly';
  else                                       required = 'yearly'; // exemption possible

  const actual = String(company?.vat_report_period ?? '').toLowerCase();
  if (!actual) return [];

  // Only flag when the configured frequency is INSUFFICIENT (under-reporting risk).
  // Filing more often than required is not a problem → no warning.
  const rank = { yearly: 0, quarterly: 1, monthly: 2 };
  if ((rank[actual] ?? 0) >= (rank[required] ?? 0)) return [];

  return [finding('C-04', 'WARNING', [],
    '§18 Abs. 2 UStG (2025)',
    { prior_year_zahllast: zahllast, required_period: required, configured_period: actual,
      thresholds: { monthly: `> ${USTVA_MONTHLY_MIN}`, quarterly: `${USTVA_QUARTERLY_MIN}–${USTVA_MONTHLY_MIN}` } }
  )];
}

// ---------------------------------------------------------------------------
// C-08: Gewerbetreibender approaching the Bilanzierungspflicht revenue limit
// ---------------------------------------------------------------------------
function checkC08(entries, company, period) {
  const form = String(company?.legal_form ?? '').toLowerCase();
  if (!/gewerbe/.test(form)) return [];
  const months = monthsInPeriod(period);
  const n = months ? months.length : 12;
  const periodRevenue = sum((entries ?? []).filter(isIncome), e => e.amount_net ?? e.amount_gross);
  const annualized = n > 0 ? periodRevenue * (12 / n) : periodRevenue;
  if (annualized <= BILANZ_REVENUE_WARN) return [];
  return [finding('C-08', 'WARNING', [],
    '§141 AO',
    { annualized_revenue: +annualized.toFixed(2), warn_level: BILANZ_REVENUE_WARN, hard_limit: 800000 }
  )];
}

// ---------------------------------------------------------------------------
// C-09: Settings say Regelbesteuerer but all invoices behave like Kleinunternehmer
// ---------------------------------------------------------------------------
function checkC09(invoices, company) {
  if (String(company?.vat_status) !== 'Regelbesteuerer') return [];
  const outgoing = (invoices ?? []).filter(i => i.type === 'outgoing');
  if (outgoing.length === 0) return [];

  const anyWithVat = outgoing.some(i => (i.vat_rate ?? 0) > 0);
  if (anyWithVat) return [];

  const note = i => String(i.vat_exempt_note ?? i.vat_exempt_reason ?? '').toLowerCase();
  const kuLike = outgoing.filter(i => note(i).includes('§19') || note(i).includes('kleinunternehmer'));
  if (kuLike.length / outgoing.length < 0.9) return [];

  return [finding('C-09', 'WARNING',
    kuLike.map(i => i.id),
    '§19 UStG / §14 UStG',
    { vat_status: 'Regelbesteuerer', outgoing_invoices: outgoing.length, kleinunternehmer_invoices: kuLike.length }
  )];
}

// ===========================================================================
// Block E — logical consistency (second pass). INFO/WARNING, tuned conservative.
// ===========================================================================

const MIXED_USE_RE = /phone|telefon|internet|kfz|vehicle|car|auto|home.?office|arbeitszimmer/i;
function businessShare(e) { return 1 - (e.private_use_split ?? 0); }
function isRoundSum(amt) { return amt != null && amt > 0 && Math.round(amt) === amt && amt % 50 === 0; }
function normalizeParty(name) {
  return String(name ?? '').toLowerCase().replace(/\s+(gmbh|ag|ug|kg|ohg|ltd|inc|llc|sarl|b\.?v\.?|e\.?k\.?)\.?$/g, '').trim();
}

// E-01: inconsistent private-use split between logically linked categories (>20pp)
function checkE01(entries) {
  const groups = {};
  for (const e of entries ?? []) {
    if (e.is_private_use !== true && e.private_use_split == null) continue;
    const c = String(e.category ?? '').toLowerCase();
    let key = null;
    if (/phone|telefon/.test(c)) key = 'phone';
    else if (/internet/.test(c)) key = 'internet';
    else if (/vehicle|kfz|car|auto|fuel|tank/.test(c)) key = 'vehicle';
    if (!key) continue;
    (groups[key] = groups[key] ?? []).push(businessShare(e));
  }
  const avg = k => groups[k] ? groups[k].reduce((s, x) => s + x, 0) / groups[k].length : null;
  const out = [];
  const pairs = [['phone', 'internet'], ['vehicle', 'phone']];
  for (const [a, b] of pairs) {
    const sa = avg(a), sb = avg(b);
    if (sa == null || sb == null) continue;
    if (Math.abs(sa - sb) > 0.20) {
      out.push(finding('E-01', 'WARNING', [],
        '§4 Abs. 4 EStG / Betriebsprüfung',
        { category_a: a, share_a_pct: +(sa * 100).toFixed(0), category_b: b, share_b_pct: +(sb * 100).toFixed(0) }
      ));
    }
  }
  return out;
}

// E-02: implausible boundary private-use shares (claims 100% business on mixed-use)
function checkE02(entries) {
  const out = [];
  for (const e of entries ?? []) {
    if (e.is_private_use !== true) continue;
    const share = businessShare(e);
    const c = String(e.category ?? '').toLowerCase();
    let flag = false;
    if (/internet/.test(c) && share > 0.80) flag = true;
    else if (/phone|telefon/.test(c) && share >= 1.0) flag = true;
    else if (/vehicle|kfz|car|auto/.test(c) && share >= 1.0) flag = true;
    else if (/bewirtung|entertainment/.test(c) && share > 0.90) flag = true;
    if (!flag) continue;
    out.push(finding('E-02', 'WARNING', [e.id],
      '§4 Abs. 4 / §4 Abs. 5 EStG',
      { category: e.category, business_share_pct: +(share * 100).toFixed(0) }
    ));
  }
  return out;
}

// E-03: Bewirtungskosten exceed the industry Richtsatz share of revenue
function checkE03(entries, company) {
  const revenue = sum((entries ?? []).filter(isIncome), e => e.amount_net ?? e.amount_gross);
  if (revenue <= 0) return [];
  const bewirtung = (entries ?? []).filter(e =>
    String(e.account_code) === '4650' || String(e.account_code) === '6640' ||
    /bewirtung|entertainment/i.test(e.category ?? '')
  );
  const total = sum(bewirtung, e => e.amount_gross);
  if (total <= 0) return [];
  const activity = String(company?.type_of_activity ?? '').toLowerCase();
  let threshold = 0.03; // services default
  if (/consult|berat/.test(activity)) threshold = 0.05;
  else if (/handel|retail|shop|commerce/.test(activity)) threshold = 0.02;
  if (total / revenue <= threshold) return [];
  return [finding('E-03', 'WARNING', bewirtung.map(e => e.id),
    '§4 Abs. 5 Nr. 2 EStG / Richtsätze BMF',
    { bewirtung_total: +total.toFixed(2), revenue: +revenue.toFixed(2), ratio_pct: +(total / revenue * 100).toFixed(1), threshold_pct: threshold * 100 }
  )];
}

// E-04: private-use split changes >25pp between periods (needs ≥2 periods)
function checkE04(entries) {
  const byCatPeriod = {};
  for (const e of entries ?? []) {
    if (e.is_private_use !== true && e.private_use_split == null) continue;
    const c = String(e.category ?? '').toLowerCase();
    const p = String(e.date ?? '').slice(0, 7);
    if (!c || !p) continue;
    (byCatPeriod[c] = byCatPeriod[c] ?? {});
    (byCatPeriod[c][p] = byCatPeriod[c][p] ?? []).push(businessShare(e));
  }
  const out = [];
  for (const [cat, periods] of Object.entries(byCatPeriod)) {
    const keys = Object.keys(periods).sort();
    if (keys.length < 2) continue;
    const avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
    const first = avg(periods[keys[0]]), last = avg(periods[keys[keys.length - 1]]);
    if (Math.abs(first - last) > 0.25) {
      out.push(finding('E-04', 'WARNING', [],
        '§4 Abs. 4 EStG',
        { category: cat, from_pct: +(first * 100).toFixed(0), to_pct: +(last * 100).toFixed(0), from: keys[0], to: keys[keys.length - 1] }
      ));
    }
  }
  return out;
}

// E-05: major expense category share of revenue outside industry norms (INFO)
function checkE05(entries, company, business_context) {
  const revenue = sum((entries ?? []).filter(isIncome), e => e.amount_net ?? e.amount_gross);
  if (revenue <= 0) return [];
  const activity = String(company?.type_of_activity ?? '').toLowerCase();
  const isRetail = /handel|retail|shop|commerce|fba/.test(activity);
  const byCat = {};
  for (const e of (entries ?? []).filter(isExpense)) {
    const c = String(e.category ?? '').toLowerCase();
    byCat[c] = (byCat[c] ?? 0) + (e.amount_net ?? e.amount_gross ?? 0);
  }
  const out = [];
  const flagIf = (match, limit, label) => {
    const total = Object.entries(byCat).filter(([c]) => match.test(c)).reduce((s, [, v]) => s + v, 0);
    if (total > 0 && total / revenue > limit) {
      out.push(finding('E-05', 'INFO', [],
        'Richtsätze BMF',
        { category: label, total: +total.toFixed(2), ratio_pct: +(total / revenue * 100).toFixed(1), limit_pct: +(limit * 100).toFixed(0) }
      ));
    }
  };
  flagIf(/phone|telefon|internet/, isRetail ? 0.03 : 0.05, 'Phone & Internet');
  flagIf(/travel|reise|command/, 0.15, 'Travel');
  if (!business_context?.sells_physical_goods && !business_context?.uses_marketplace) flagIf(/marketing|werbung/, 0.20, 'Marketing');
  if (!/it|software|develop/.test(activity)) flagIf(/software|lizenz|license/, 0.10, 'Software');
  return out;
}

// E-06: round-sum pattern per expense category (>60% round) → INFO
function checkE06(entries) {
  const byCat = {};
  for (const e of (entries ?? []).filter(isExpense)) {
    const c = String(e.category ?? '').toLowerCase();
    if (/rent|miete|abo|subscription|leasing/.test(c)) continue; // fixed payments excluded
    (byCat[c] = byCat[c] ?? []).push(e);
  }
  const out = [];
  for (const [cat, list] of Object.entries(byCat)) {
    if (list.length < 3) continue; // need a meaningful sample
    const roundShare = list.filter(e => isRoundSum(e.amount_gross)).length / list.length;
    if (roundShare > 0.60) {
      out.push(finding('E-06', 'INFO', list.map(e => e.id),
        'GoBD / §162 AO (Schätzung)',
        { category: cat, round_share_pct: +(roundShare * 100).toFixed(0), count: list.length }
      ));
    }
  }
  return out;
}

// E-07: expected paired records missing.
// Scoped to avoid duplicating B-01/B-Kfz-01/B-EÜR-01: only flags Bewirtung that is
// explicitly missing its §4(5) documentation flag (no false positive when unknown).
function checkE07(entries) {
  const out = [];
  for (const e of entries ?? []) {
    const isBewirtung = String(e.account_code) === '4650' || /bewirtung/i.test(e.category ?? '');
    if (!isBewirtung) continue;
    if (e.bewirtungsbeleg === false || e.has_receipt === false) {
      out.push(finding('E-07', 'WARNING', [e.id],
        '§4 Abs. 5 Nr. 2 EStG',
        { category: e.category, reason: 'missing_bewirtungsbeleg' }
      ));
    }
  }
  return out;
}

// E-08: December expense spike vs Jan–Nov average (needs full-year data) → INFO
function checkE08(entries) {
  const monthly = {};
  for (const e of (entries ?? []).filter(isExpense)) {
    const m = Number(String(e.date ?? '').slice(5, 7));
    if (!m) continue;
    monthly[m] = (monthly[m] ?? 0) + (e.amount_gross ?? 0);
  }
  const janNov = [];
  for (let m = 1; m <= 11; m++) if (monthly[m] != null) janNov.push(monthly[m]);
  if (janNov.length < 6 || monthly[12] == null) return []; // not enough year coverage
  const avg = janNov.reduce((s, x) => s + x, 0) / janNov.length;
  if (avg <= 0 || monthly[12] <= avg * 2.5) return [];
  return [finding('E-08', 'INFO', [],
    'ELSTER RMS / Betriebsprüfung',
    { december: +monthly[12].toFixed(2), jan_nov_avg: +avg.toFixed(2), ratio: +(monthly[12] / avg).toFixed(1) }
  )];
}

// E-09: bidirectional payments with the same counterparty → WARNING
function checkE09(transactions) {
  const groups = {};
  for (const t of transactions ?? []) {
    const k = normalizeParty(t.counterparty);
    if (!k) continue;
    const g = (groups[k] = groups[k] ?? { in: [], out: [] });
    (t.type === 'incoming' ? g.in : g.out).push(t);
  }
  const out = [];
  for (const [party, g] of Object.entries(groups)) {
    if (g.in.length === 0 || g.out.length === 0) continue;
    out.push(finding('E-09', 'WARNING',
      [...g.in.map(t => t.id), ...g.out.map(t => t.id)],
      '§11 EStG (Zufluss-Abfluss, Aufrechnungsverbot)',
      { counterparty: party, incoming: g.in.length, outgoing: g.out.length,
        incoming_total: +sum(g.in, t => t.amount).toFixed(2), outgoing_total: +sum(g.out, t => t.amount).toFixed(2) }
    ));
  }
  return out;
}

// E-10: 100% business share on a mixed-use category not already covered by E-02 → INFO
function checkE10(entries) {
  const out = [];
  for (const e of entries ?? []) {
    if (e.is_private_use !== true) continue;
    if (businessShare(e) < 1.0) continue;
    const c = String(e.category ?? '').toLowerCase();
    if (!MIXED_USE_RE.test(c)) continue;
    // phone/internet/vehicle 100% business are owned by E-02 → only flag others (e.g. home office)
    if (/phone|telefon|internet|vehicle|kfz|car|auto/.test(c)) continue;
    out.push(finding('E-10', 'INFO', [e.id],
      '§4 Abs. 4 EStG',
      { category: e.category, business_share_pct: 100 }
    ));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner — executes all aggregate checks and returns a flat findings array.
// ---------------------------------------------------------------------------
function runAggregateChecks(data) {
  const { company, business_context, invoices, transactions, entries, assets, reports_eur, reports_ustva, period } = data;
  const findings = [];
  const add = (arr) => { for (const f of (arr ?? [])) if (f) findings.push(f); };

  // B-EÜR / B-UStVA / C
  add(checkB04(entries, reports_eur));
  add(checkB06(entries));
  add(checkB07(entries, business_context));
  add(checkBUStVA01(entries));
  add(checkBUStVA02(reports_ustva, period));
  add(checkBEUR01(assets, entries, period));
  add(checkC01(entries, company, reports_ustva));
  add(checkC02(entries, company, period, reports_eur));
  add(checkC04(reports_ustva, company));
  add(checkC08(entries, company, period));
  add(checkC09(invoices, company));

  // Block E (logical consistency)
  add(checkE01(entries));
  add(checkE02(entries));
  add(checkE03(entries, company));
  add(checkE04(entries));
  add(checkE05(entries, company, business_context));
  add(checkE06(entries));
  add(checkE07(entries));
  add(checkE08(entries));
  add(checkE09(transactions));
  add(checkE10(entries));

  return findings;
}

module.exports = {
  runAggregateChecks,
  checkB04, checkB06, checkB07, checkBUStVA01, checkBUStVA02, checkBEUR01,
  checkC01, checkC02, checkC04, checkC08, checkC09,
  checkE01, checkE02, checkE03, checkE04, checkE05, checkE06, checkE07, checkE08, checkE09, checkE10,
  monthsInPeriod,
};
