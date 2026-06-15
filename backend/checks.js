'use strict';

// ---------------------------------------------------------------------------
// EU country codes — used by A-12, B-ZM-01, B-Type-01
// ---------------------------------------------------------------------------
const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DK','EE','ES','FI','FR',
  'GR','HR','HU','IE','IT','LT','LU','LV','MT','NL',
  'PL','PT','RO','SE','SI','SK'
]);

// Restaurant / food keywords for B-Cat-01
const RESTAURANT_KEYWORDS = ['restaurant', 'cafe', 'café', 'bistro', 'imbiss', 'gaststätte',
  'gasthaus', 'speise', 'bewirtung', 'mensa', 'kantine', 'pizza', 'sushi', 'bäckerei'];

// Software / SaaS keywords for B-Cat-01
const SOFTWARE_KEYWORDS = ['lizenz', 'license', 'abo', 'subscription', 'saas', 'software',
  'abonnement', 'plan', 'hosting', 'cloud'];

// Strong, explicit refund vocabulary for A-10 (German terms unambiguously mean refund/reversal)
const REFUND_KEYWORDS = ['erstattung', 'rückerstattung', 'rückzahlung', 'refund', 'cashback',
  'storno', 'gutschrift'];

// Known marketplace platform names for A-11
const MARKETPLACE_NAMES = ['amazon', 'etsy', 'upwork', 'fiverr', 'ebay'];

// SKR-04 (Finom-mapping) vehicle account codes
const VEHICLE_REPAIR_CODE    = '6540';                                   // Motor Vehicle Repairs
const VEHICLE_OPERATING_CODES = ['6520', '6530', '6560', '6570', '6580', '7685']; // insurance, ongoing, leasing, other, tax

// ---------------------------------------------------------------------------
// Helper: build a finding object
// ---------------------------------------------------------------------------
function finding(check_id, severity, affected, rule_reference, computed) {
  return { check_id, severity, affected, rule_reference, computed };
}

// ---------------------------------------------------------------------------
// A-01: Amount mismatch between invoice and transaction (tolerance ±€0.02)
// ---------------------------------------------------------------------------
function checkA01(invoice, transaction) {
  if (!invoice || !transaction) return null;
  const diff = Math.abs((invoice.amount_gross ?? 0) - (transaction.amount ?? 0));
  if (diff <= 0.02) return null;
  return finding('A-01', 'ERROR',
    [invoice.id, transaction.id].filter(Boolean),
    '§14 UStG',
    { invoice_amount: invoice.amount_gross, transaction_amount: transaction.amount, diff: +diff.toFixed(2) }
  );
}

// ---------------------------------------------------------------------------
// A-02: VAT rate mismatch between invoice and bookkeeping entry
// ---------------------------------------------------------------------------
function checkA02(invoice, entry) {
  if (!invoice || !entry) return null;
  // Skip if entry has no vat_rate field at all (not relevant)
  if (entry.vat_rate === undefined || entry.vat_rate === null) return null;
  if (invoice.vat_rate === entry.vat_rate) return null;
  return finding('A-02', 'ERROR',
    [invoice.id, entry.id].filter(Boolean),
    '§14 UStG / UStVA',
    { invoice_vat_rate: invoice.vat_rate, entry_vat_rate: entry.vat_rate }
  );
}

// ---------------------------------------------------------------------------
// A-05: Kleinunternehmer issuing outgoing invoice with vat_rate > 0
// ---------------------------------------------------------------------------
function checkA05(company, invoice) {
  if (!company || !invoice) return null;
  if (company.vat_status !== 'Kleinunternehmer') return null;
  if (invoice.type !== 'outgoing') return null;
  if ((invoice.vat_rate ?? 0) <= 0) return null;
  return finding('A-05', 'ERROR',
    [invoice.id].filter(Boolean),
    '§19 UStG',
    { vat_status: company.vat_status, invoice_vat_rate: invoice.vat_rate }
  );
}

// ---------------------------------------------------------------------------
// A-06: Regelbesteuerer issuing outgoing invoice with vat_rate = 0
//        WARNING if no exempt reason; ERROR if exempt reason references §19
// ---------------------------------------------------------------------------
function checkA06(company, invoice) {
  if (!company || !invoice) return null;
  if (company.vat_status !== 'Regelbesteuerer') return null;
  if (invoice.type !== 'outgoing') return null;
  if ((invoice.vat_rate ?? -1) !== 0) return null;

  // Data field is `vat_exempt_note`; keep `vat_exempt_reason` as a fallback.
  const reasonRaw = invoice.vat_exempt_note ?? invoice.vat_exempt_reason ?? '';
  const reason    = String(reasonRaw).toLowerCase();

  // Legitimate exemptions — do not flag
  if (reason.includes('reverse charge') || reason.includes('§13b') || reason === 'reverse_charge') return null;
  if (reason.includes('§3a') || reason.includes('§4 ustg')) return null;
  if (reason.includes('drittland') || reason.includes('non-eu')) return null;

  // §19 on a Regelbesteuerer → ERROR
  if (reason.includes('§19') || reason.includes('kleinunternehmer')) {
    return finding('A-06', 'ERROR',
      [invoice.id].filter(Boolean),
      '§19 UStG',
      { vat_status: company.vat_status, vat_exempt_reason: reasonRaw }
    );
  }

  // No reason given → WARNING
  return finding('A-06', 'WARNING',
    [invoice.id].filter(Boolean),
    '§14 UStG',
    { vat_status: company.vat_status, vat_exempt_reason: null }
  );
}

// ---------------------------------------------------------------------------
// A-12: Supplier/customer country incompatible with applied VAT regime
//        Specifically: EU supplier + RC not applied (RC flag false, vat_rate > 0)
// ---------------------------------------------------------------------------
function checkA12(invoice, entry) {
  if (!invoice || !entry) return null;

  const supplierCountry = invoice.supplier_country ?? null;

  // Only applies to incoming invoices (supplier is the foreign party)
  if (invoice.type !== 'incoming') return null;

  if (!supplierCountry || supplierCountry === 'DE') return null;
  if (!EU_COUNTRIES.has(supplierCountry)) return null;

  // RC should be applied for EU suppliers of services
  // Flag only if RC was NOT applied AND a positive VAT rate is stored
  if (entry.reverse_charge_flag === true) return null;
  // RC omission only matters when the supplier did NOT charge VAT (0% invoice).
  // If the EU supplier charged VAT (e.g. registered in DE / marketplace charging
  // German VAT), it is a normal taxable purchase with deductible Vorsteuer — not a
  // Reverse-Charge error. Avoids false positives on EU marketplaces (Amazon LU etc.).
  if ((invoice.vat_rate ?? 0) > 0) return null;
  // If vat_rate_if_domestic is set, use that; otherwise fall back to entry.vat_rate
  const appliedRate = entry.vat_rate_if_domestic ?? entry.vat_rate ?? 0;
  if (appliedRate <= 0) return null;

  return finding('A-12', 'ERROR',
    [invoice.id, entry.id].filter(Boolean),
    '§13b UStG',
    { supplier_country: supplierCountry, reverse_charge_flag: entry.reverse_charge_flag, applied_vat_rate: appliedRate }
  );
}

// ---------------------------------------------------------------------------
// A-09: Mismatch between invoice file OCR result and stored invoice fields
//        Skips gracefully if recognized_data is null / unavailable
// ---------------------------------------------------------------------------
function checkA09(invoice, recognized_data) {
  if (!invoice || !recognized_data) return null;

  const affected = [invoice.id].filter(Boolean);
  const computed = {};
  let hasIssue = false;

  if (recognized_data.amount_gross !== undefined) {
    const diff = Math.abs((recognized_data.amount_gross ?? 0) - (invoice.amount_gross ?? 0));
    if (diff > 0.02) {
      computed.recognized_amount = recognized_data.amount_gross;
      computed.stored_amount = invoice.amount_gross;
      computed.amount_diff = +diff.toFixed(2);
      hasIssue = true;
    }
  }

  if (recognized_data.vat_rate !== undefined && recognized_data.vat_rate !== null) {
    if (recognized_data.vat_rate !== invoice.vat_rate) {
      computed.recognized_vat_rate = recognized_data.vat_rate;
      computed.stored_vat_rate = invoice.vat_rate;
      hasIssue = true;
    }
  }

  if (!hasIssue) return null;
  return finding('A-09', 'ERROR', affected, '§14 UStG / GoBD', computed);
}

// ---------------------------------------------------------------------------
// B-05: Vorsteuer claimed on invoice from Kleinunternehmer supplier
//        Heuristic: invoice.vat_rate === 0 (supplier charges no VAT)
//        but entry records a positive vat_rate (Vorsteuer claimed)
// ---------------------------------------------------------------------------
function checkB05(invoice, entry) {
  if (!invoice || !entry) return null;
  if (invoice.type !== 'incoming') return null;
  if ((invoice.vat_rate ?? -1) !== 0) return null;
  if ((entry.vat_rate ?? 0) <= 0) return null;
  // Exclude legitimate 0% cases: RC (EU/non-EU supplier) — those are handled by A-12
  if (entry.reverse_charge_flag === true) return null;
  // Supplier is domestic (DE) and charges 0% → likely Kleinunternehmer
  const supplierCountry = invoice.supplier_country ?? 'DE';
  if (supplierCountry !== 'DE') return null;

  return finding('B-05', 'ERROR',
    [invoice.id, entry.id].filter(Boolean),
    '§15 UStG / §19 UStG',
    { invoice_vat_rate: invoice.vat_rate, entry_vat_rate: entry.vat_rate, supplier_country: supplierCountry }
  );
}

// ---------------------------------------------------------------------------
// B-Cat-01: SKR04 account code incompatible with expense description
//   Pattern 1: 6650 (Reisekosten) + description contains restaurant keyword
//   Pattern 2: 6815 (Bürobedarf) + description contains software keyword
//   Pattern 3: 6260 (GWG-Sofortabschreibung) + amount_net < €250
// ---------------------------------------------------------------------------
function checkBCat01(entry, invoice) {
  if (!entry) return null;

  const code    = String(entry.account_code ?? '');
  const descRaw = [
    entry.description ?? '',
    entry.notes ?? '',
    invoice?.counterparty ?? '',
    invoice?.description ?? '',
  ].join(' ').toLowerCase();

  // Pattern 1
  if (code === '6650') {
    if (RESTAURANT_KEYWORDS.some(kw => descRaw.includes(kw))) {
      return finding('B-Cat-01', 'WARNING',
        [entry.id].filter(Boolean),
        '§4 Abs. 5 EStG',
        { account_code: code, detected_pattern: 'Bewirtungskosten als Reisekosten', suggested_account: '6670' }
      );
    }
  }

  // Pattern 2
  if (code === '6815') {
    if (SOFTWARE_KEYWORDS.some(kw => descRaw.includes(kw))) {
      return finding('B-Cat-01', 'WARNING',
        [entry.id].filter(Boolean),
        '§4 EStG / EÜR',
        { account_code: code, detected_pattern: 'Software/Lizenz als Bürobedarf', suggested_account: '6832' }
      );
    }
  }

  // Pattern 3
  if (code === '6260') {
    const net = entry.amount_net ?? entry.amount ?? 0;
    if (net < 250) {
      return finding('B-Cat-01', 'WARNING',
        [entry.id].filter(Boolean),
        '§6 Abs. 2 EStG',
        { account_code: code, amount_net: net, detected_pattern: 'GWG-Buchung unter €250-Grenze' }
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// B-Type-01: service_type incompatible with VAT regime for counterparty country
//   EU B2B incoming services → RC must be applied
//   If entry.service_type === 'services' + EU supplier + RC not applied → ERROR
// ---------------------------------------------------------------------------
function checkBType01(invoice, entry, business_context) {
  if (!invoice || !entry) return null;
  if (invoice.type !== 'incoming') return null;

  const supplierCountry = invoice.supplier_country ?? null;
  if (!supplierCountry || supplierCountry === 'DE') return null;
  if (!EU_COUNTRIES.has(supplierCountry)) return null;

  // RC omission only matters when the supplier did NOT charge VAT (0% invoice) —
  // mirrors A-12, avoids false positives on EU suppliers charging German VAT.
  if ((invoice.vat_rate ?? 0) > 0) return null;

  const serviceType = entry.service_type ?? invoice.service_type ?? null;
  if (!serviceType) return null;

  if (serviceType === 'services' && entry.reverse_charge_flag === false) {
    return finding('B-Type-01', 'ERROR',
      [invoice.id, entry.id].filter(Boolean),
      '§13b UStG',
      { supplier_country: supplierCountry, service_type: serviceType, reverse_charge_flag: false }
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// B-ZM-01: EU B2B outgoing invoice without valid customer VAT ID
// ---------------------------------------------------------------------------
function checkBZM01(invoice) {
  if (!invoice) return null;
  if (invoice.type !== 'outgoing') return null;
  if ((invoice.vat_rate ?? -1) !== 0) return null;

  const customerCountry = invoice.customer_country ?? null;
  if (!customerCountry || !EU_COUNTRIES.has(customerCountry)) return null;

  // Check that exempt reason indicates RC / EU B2B (not just §19)
  const reason = String(invoice.vat_exempt_note ?? invoice.vat_exempt_reason ?? '').toLowerCase();
  const isReverseCharge = reason.includes('reverse charge') || reason.includes('§13b') ||
    reason === 'reverse_charge';
  if (!isReverseCharge) return null;

  const vatId = invoice.customer_vat_id ?? null;
  if (vatId && String(vatId).trim().length > 3) return null; // has a VAT ID

  return finding('B-ZM-01', 'ERROR',
    [invoice.id].filter(Boolean),
    '§18a UStG',
    { customer_country: customerCountry, customer_vat_id: vatId }
  );
}

// ---------------------------------------------------------------------------
// A-10: Refund transaction not marked as refund in the linked entry
//   Trigger: transaction.payment_reference contains an explicit refund term
//   Error:   linked entry exists but transaction_subtype is not refund/cashback
// ---------------------------------------------------------------------------
function checkA10(transaction, entry) {
  if (!transaction || !entry) return null;

  const ref = String(transaction.payment_reference ?? '').toLowerCase();
  const matched = REFUND_KEYWORDS.filter(kw => ref.includes(kw));
  if (matched.length === 0) return null;

  // Entry already correctly marked as a refund → OK
  const subtype = entry.transaction_subtype ?? null;
  if (subtype === 'refund' || subtype === 'cashback') return null;

  return finding('A-10', 'ERROR',
    [transaction.id, entry.id].filter(Boolean),
    '§11 EStG (Zufluss-Abfluss)',
    {
      payment_reference:   transaction.payment_reference,
      matched_keywords:    matched,
      entry_type:          entry.type,
      transaction_subtype: subtype,
      expected_subtype:    transaction.type === 'incoming' ? 'refund (Revenue Refund)' : 'refund (Expense Refund)',
    }
  );
}

// ---------------------------------------------------------------------------
// A-11: Marketplace fee not booked as a separate expense
//   business_context.uses_marketplace == true AND transaction from a platform AND
//   transaction.amount < linked invoice gross by >2% AND no offsetting fee entry
//   (SKR-04 4780) for the difference → ERROR
//   allEntries: full bookkeeping entries array for the client/period
// ---------------------------------------------------------------------------
function checkA11(invoice, transaction, allEntries, business_context) {
  if (!invoice || !transaction) return null;
  if (!business_context?.uses_marketplace) return null;

  const counterparty = String(transaction.counterparty ?? '').toLowerCase();
  const isPlatform = MARKETPLACE_NAMES.some(p => counterparty.includes(p));
  if (!isPlatform) return null;

  if (transaction.type !== 'incoming') return null;

  const invGross = invoice.amount_gross ?? 0;
  const received = transaction.amount ?? 0;
  const diff     = +(invGross - received).toFixed(2);
  if (invGross <= 0 || diff <= 0) return null;
  if (diff / invGross <= 0.02) return null; // within 2% — rounding, not a fee

  // Look for an offsetting marketplace-fee expense entry (SKR-04 4780) close to the diff
  const FEE_CODE = '4780';
  const hasFeeEntry = (allEntries ?? []).some(e => {
    const code = String(e.account_code ?? '');
    const cat  = String(e.category ?? '').toLowerCase();
    const isFee = code === FEE_CODE || /fee|provision|commission|marketplace|gebühr/.test(cat);
    if (!isFee) return false;
    const amt = e.amount_gross ?? e.amount_net ?? 0;
    return Math.abs(amt - diff) <= diff * 0.15; // within 15% of the commission
  });
  if (hasFeeEntry) return null;

  return finding('A-11', 'ERROR',
    [transaction.id, invoice.id].filter(Boolean),
    '§4 Abs. 3 EStG / §15 UStG',
    {
      platform:          transaction.counterparty,
      invoice_gross:     invGross,
      received_amount:   received,
      fee_difference:    diff,
      suggested_account: '4780',
    }
  );
}

// ---------------------------------------------------------------------------
// A-13: Duplicate invoice detection (pairwise over the invoice list)
//   invoices: array → returns an array of findings (possibly empty)
// ---------------------------------------------------------------------------
function partyName(inv) {
  return String(inv.supplier_name ?? inv.customer_name ?? '').trim().toLowerCase();
}
function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}
function findDuplicateInvoices(invoices) {
  const out = [];
  const list = invoices ?? [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!a || !b) continue;
      if (a.type !== b.type) continue; // compare like-with-like
      const sameParty  = partyName(a) && partyName(a) === partyName(b);
      const sameAmount = (a.amount_gross ?? null) !== null && a.amount_gross === b.amount_gross;
      const sameNumber = a.invoice_number && a.invoice_number === b.invoice_number;
      const diffTxn    = (a.linked_transaction_id ?? null) !== (b.linked_transaction_id ?? null);
      const within7    = daysBetween(a.date, b.date) <= 7;

      if (!sameAmount || !sameParty) continue; // amount+party is the minimum signal

      // Recurring billing (monthly/quarterly retainers, subscriptions) legitimately
      // repeats the same party+amount with DIFFERENT invoice numbers, spaced far apart.
      // Real duplicates are near-simultaneous → require date proximity unless the
      // invoice number itself is reused (a strong duplicate signal on its own).
      let severity = null, scenario = null;
      if (sameNumber) { severity = 'ERROR'; scenario = 'invoice_number+supplier+amount'; }
      else if (within7 && diffTxn) { severity = 'ERROR'; scenario = 'supplier+amount+date≤7d+different_transactions'; }
      else if (within7) { severity = 'WARNING'; scenario = 'supplier+amount+date≤7d'; }
      else continue; // same party+amount but spaced apart → recurring, not a duplicate

      out.push(finding('A-13', severity,
        [a.id, b.id],
        '§14 UStG / Doppelerfassung',
        {
          scenario,
          party: a.supplier_name ?? a.customer_name,
          amount_gross: a.amount_gross,
          invoice_numbers: [a.invoice_number, b.invoice_number],
          linked_transactions: [a.linked_transaction_id, b.linked_transaction_id],
        }
      ));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// A-15: Document age — transaction posted >90 days after the invoice date (INFO)
// ---------------------------------------------------------------------------
function checkA15(invoice, transaction) {
  if (!invoice || !transaction) return null;
  const gap = daysBetween(invoice.date, transaction.date);
  if (!isFinite(gap) || gap <= 90) return null;
  return finding('A-15', 'INFO',
    [invoice.id, transaction.id].filter(Boolean),
    'GoBD / EÜR Zufluss-Abfluss',
    { invoice_date: invoice.date, transaction_date: transaction.date, days_gap: Math.round(gap) }
  );
}

// ---------------------------------------------------------------------------
// B-01: Vehicle OPERATING costs (insurance/ongoing/leasing/tax) without a
//        registered business vehicle asset. Repairs (6540) are owned by B-Kfz-01.
//   assets: full asset array for the client
// ---------------------------------------------------------------------------
function hasVehicleAsset(assets) {
  return (assets ?? []).some(a => a.is_vehicle === true || /vehicle|car|truck|pkw|lkw/i.test(a.category ?? ''));
}
function checkB01(entry, assets) {
  if (!entry) return null;
  const code = String(entry.account_code ?? '');
  if (!VEHICLE_OPERATING_CODES.includes(code)) return null;
  if (hasVehicleAsset(assets)) return null;
  return finding('B-01', 'ERROR',
    [entry.id].filter(Boolean),
    '§4 Abs. 4 EStG / §6 EStG',
    { account_code: code, category: entry.category, amount_gross: entry.amount_gross }
  );
}

// ---------------------------------------------------------------------------
// B-Kfz-01: Vehicle repair (6540) regime mismatch
//   Scenario A (ERROR):   repair entry + NO vehicle asset → private car, not deductible
//   Scenario B (WARNING): repair entry + 1%-Regel vehicle asset + NO operating-cost
//                         entries (fuel/insurance/tax) → incomplete expense recording
//   allEntries: full bookkeeping entries array (for Scenario B)
// ---------------------------------------------------------------------------
function checkBKfz01(entry, assets, allEntries) {
  if (!entry) return null;
  if (String(entry.account_code ?? '') !== VEHICLE_REPAIR_CODE) return null;

  // Scenario A — no vehicle asset
  if (!hasVehicleAsset(assets)) {
    return finding('B-Kfz-01', 'ERROR',
      [entry.id].filter(Boolean),
      '§4 Abs. 4 EStG / §9 EStG (Kilometerpauschale)',
      { account_code: VEHICLE_REPAIR_CODE, amount_gross: entry.amount_gross, reason: 'no_vehicle_asset' }
    );
  }

  // Scenario B — 1%-Regel asset, repair present, but no operating-cost entries
  const onePercentAsset = (assets ?? []).some(a =>
    (a.is_vehicle === true) &&
    /1.?percent|1%/i.test(String(a.vehicle_details?.private_use_method ?? a.amortization_method ?? ''))
  );
  if (!onePercentAsset) return null;

  const hasOperating = (allEntries ?? []).some(e =>
    VEHICLE_OPERATING_CODES.includes(String(e.account_code ?? ''))
  );
  if (hasOperating) return null;

  return finding('B-Kfz-01', 'WARNING',
    [entry.id].filter(Boolean),
    '§6 Abs. 1 Nr. 4 EStG (1%-Regelung)',
    { account_code: VEHICLE_REPAIR_CODE, amount_gross: entry.amount_gross, reason: 'missing_operating_costs_under_1pct' }
  );
}

// ---------------------------------------------------------------------------
// B-08: Privateinlage / Privatentnahme on a legal form where it does not apply
// ---------------------------------------------------------------------------
const CAPITAL_COMPANY_FORMS = ['gmbh', 'ug', 'ag'];
function checkB08(entry, company) {
  if (!entry || !company) return null;
  const cat  = String(entry.category ?? '').toLowerCase();
  const code = String(entry.account_code ?? '');
  const isPrivate = cat.includes('privateinlage') || cat.includes('privatentnahme') ||
    code === '1800' || code === '1890';
  if (!isPrivate) return null;
  const form = String(company.legal_form ?? '').toLowerCase();
  if (!CAPITAL_COMPANY_FORMS.some(f => form.includes(f))) return null;
  return finding('B-08', 'WARNING',
    [entry.id].filter(Boolean),
    'Gesellschaftsrecht / §4 EStG',
    { legal_form: company.legal_form, category: entry.category, account_code: code }
  );
}

// ---------------------------------------------------------------------------
// B-09: Expense atypical for the declared type_of_activity (INFO, conservative)
//   Only flags a clearly-unrelated pattern to keep false positives low.
// ---------------------------------------------------------------------------
function checkB09(entry, company) {
  if (!entry || !company) return null;
  const activity = String(company.type_of_activity ?? '').toLowerCase();
  const desc     = `${entry.category ?? ''} ${entry.description ?? ''}`.toLowerCase();

  // Kitchen / catering equipment for a non-gastronomy, office-based activity
  const isKitchen = /küche|kitchen|gastro|herd|kühlschrank|cooking/.test(desc);
  const officeBased = /it|software|consult|design|coach|train|berat|develop|market|übersetz|translat|photo|foto/.test(activity);
  if (isKitchen && officeBased && !/gastro|restaurant|catering|food/.test(activity)) {
    return finding('B-09', 'INFO',
      [entry.id].filter(Boolean),
      '§4 Abs. 4 EStG (betriebliche Veranlassung)',
      { type_of_activity: company.type_of_activity, category: entry.category, description: entry.description }
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// AfA-Tabellen ranges by asset category (source: Tax_Rules_Reference.md / catalog B-02)
//   {min, max} = acceptable useful-life range in years; outside → WARNING
//   isLand → any period > 0 is an ERROR (§6 Abs. 1 Nr. 2 EStG)
// Computers & software accept 1 year (BMF 26.02.2021 digital-asset rule).
// ---------------------------------------------------------------------------
function afaRangeFor(category) {
  const c = String(category ?? '').toLowerCase();
  if (/land|grund und boden/.test(c))                   return { isLand: true };
  if (/software|lizenz|license/.test(c))                return { min: 1,  max: 5,  std: 3 };
  if (/technolog|computer|laptop|notebook|tablet|smartphone|pc|it[-\s]/.test(c)) return { min: 1, max: 5, std: 3 };
  if (/photo|foto|kamera|camera|video/.test(c))         return { min: 3,  max: 12, std: 7 };
  if (/furniture|möbel|büromöbel/.test(c))              return { min: 8,  max: 20, std: 13 };
  if (/truck|lkw/.test(c))                              return { min: 6,  max: 14, std: 9 };
  if (/car|pkw|vehicle|company vehicle|fahrzeug/.test(c)) return { min: 4, max: 9, std: 6 };
  if (/building|gebäude|construction/.test(c))          return { min: 20, max: 60, std: 33 };
  if (/installation/.test(c))                           return { min: 8,  max: 30, std: 15 };
  if (/equipment|tool|werkzeug|gerät|machine|maschine/.test(c)) return { min: 5, max: 15, std: 10 };
  return null; // unknown category — do not flag
}

// ---------------------------------------------------------------------------
// B-02: Depreciation period inconsistent with AfA-Tabellen
//   Land with any period → ERROR; otherwise out-of-range → WARNING
// ---------------------------------------------------------------------------
function checkB02(asset) {
  if (!asset) return null;
  const years = asset.amortization_period_years;
  const range = afaRangeFor(asset.category);
  if (!range) return null;

  if (range.isLand) {
    if ((years ?? 0) > 0) {
      return finding('B-02', 'ERROR',
        [asset.id].filter(Boolean),
        '§6 Abs. 1 Nr. 2 EStG',
        { asset: asset.name, category: asset.category, amortization_period_years: years }
      );
    }
    return null;
  }

  if (years === null || years === undefined) return null;
  if (years >= range.min && years <= range.max) return null;

  return finding('B-02', 'WARNING',
    [asset.id].filter(Boolean),
    'AfA-Tabellen (BMF) / §7 EStG',
    { asset: asset.name, category: asset.category, amortization_period_years: years, expected_range: `${range.min}–${range.max}`, standard: range.std }
  );
}

// ---------------------------------------------------------------------------
// B-03: Asset has no linked purchase transaction and no matching booking
//   Skips assets acquired outside the available transaction window (historical).
// ---------------------------------------------------------------------------
function amountMatch(a, b, pct = 0.05) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.abs(b) * pct;
}
function checkB03(asset, transactions, entries) {
  if (!asset) return null;
  if (asset.linked_transaction_id) return null;

  const price = asset.purchase_price;
  const start = asset.start_date;
  if (price == null || !start) return null;

  const near = (dateStr) => daysBetween(dateStr, start) <= 30;
  const hasTxn   = (transactions ?? []).some(t => near(t.date) && amountMatch(t.amount, price));
  const hasEntry = (entries ?? []).some(e => near(e.date) && (amountMatch(e.amount_gross, price) || amountMatch(e.amount_net, price)));
  if (hasTxn || hasEntry) return null;

  // Guard: if no transaction exists anywhere near the asset's start date, the
  // purchase predates the analysed data window — cannot confirm/deny, so skip.
  const anyNearby = (transactions ?? []).some(t => daysBetween(t.date, start) <= 180);
  if (!anyNearby) return null;

  return finding('B-03', 'WARNING',
    [asset.id].filter(Boolean),
    '§4 Abs. 3 EStG / GoBD',
    { asset: asset.name, purchase_price: price, start_date: start }
  );
}

// ---------------------------------------------------------------------------
// B-EÜR-02: Expense above the GWG threshold (€800 net) not capitalised
//   (threshold from Tax_Rules_Reference.md). Requires a durable-asset description
//   and the absence of a matching asset record.
// ---------------------------------------------------------------------------
const GWG_NET_THRESHOLD = 800; // §6 Abs. 2 EStG (TRR)
const DURABLE_KEYWORDS = ['computer', 'laptop', 'macbook', 'notebook', 'server', 'kamera', 'camera',
  'canon', 'sony', 'nikon', 'systemkamera', 'objektiv', 'lens', 'möbel', 'furniture', 'schreibtisch',
  'regal', 'maschine', 'machine', 'gerät', 'drucker', 'printer', 'monitor', 'display', 'beamer',
  'werkzeug', 'equipment', 'e-bike', 'fahrrad'];
const CONSUMABLE_KEYWORDS = ['papier', 'patrone', 'cartridge', 'toner', 'kabel', 'akku', 'batterie',
  'zubehör', 'accessory', 'verbrauch', 'set'];
const ASSET_ACCOUNT_CODES = ['0135', '0520', '0540', '0560', '0630', '0650', '0680', '0240', '0235', '0500'];

function checkBEUR02(entry, assets) {
  if (!entry) return null;
  if (entry.type !== 'expense') return null;
  const net = entry.amount_net ?? entry.amount ?? 0;
  if (net <= GWG_NET_THRESHOLD) return null;

  const code = String(entry.account_code ?? '');
  if (ASSET_ACCOUNT_CODES.includes(code) || code === '0670' || code === '6260') return null; // already an asset / GWG account

  const desc = `${entry.description ?? ''} ${entry.category ?? ''}`.toLowerCase();
  if (CONSUMABLE_KEYWORDS.some(k => desc.includes(k))) return null;
  if (!DURABLE_KEYWORDS.some(k => desc.includes(k))) return null;

  // Already capitalised? linked asset or a matching asset price
  if (entry.linked_asset_id) return null;
  const gross = entry.amount_gross ?? net;
  const hasAsset = (assets ?? []).some(a => amountMatch(a.purchase_price, net) || amountMatch(a.purchase_price, gross));
  if (hasAsset) return null;

  return finding('B-EÜR-02', 'ERROR',
    [entry.id].filter(Boolean),
    '§6 Abs. 2 EStG / §7 EStG',
    { account_code: code, amount_net: net, threshold: GWG_NET_THRESHOLD, description: entry.description }
  );
}

// ---------------------------------------------------------------------------
// B-EÜR-03: Asset account code used but no matching asset created (GWG 0670 exempt)
// ---------------------------------------------------------------------------
function checkBEUR03(entry, assets) {
  if (!entry) return null;
  const code = String(entry.account_code ?? '');
  if (!ASSET_ACCOUNT_CODES.includes(code)) return null;

  if (entry.linked_asset_id) return null;
  const net = entry.amount_net ?? entry.amount ?? 0;
  const gross = entry.amount_gross ?? net;
  const hasAsset = (assets ?? []).some(a =>
    daysBetween(a.start_date, entry.date) <= 30 &&
    (amountMatch(a.purchase_price, gross) || amountMatch(a.purchase_price, net))
  );
  if (hasAsset) return null;

  return finding('B-EÜR-03', 'ERROR',
    [entry.id].filter(Boolean),
    '§7 EStG',
    { account_code: code, amount_gross: gross, category: entry.category }
  );
}

// ---------------------------------------------------------------------------
// B-ZM-02: EU B2B invoice missing the mandatory Reverse-Charge phrase
//   Uses the stored vat_exempt_note as the invoice-document text (no OCR in the
//   main path). Outgoing, 0% VAT, EU customer, note lacks §13b phrase → WARNING.
// ---------------------------------------------------------------------------
function checkBZM02(invoice) {
  if (!invoice) return null;
  if (invoice.type !== 'outgoing') return null;
  if ((invoice.vat_rate ?? -1) !== 0) return null;

  const customerCountry = invoice.customer_country ?? null;
  if (!customerCountry || !EU_COUNTRIES.has(customerCountry)) return null;

  const note = String(invoice.vat_exempt_note ?? invoice.vat_exempt_reason ?? '').toLowerCase();
  // §19 (Kleinunternehmer) is handled by C-09 / A-06, not here
  if (note.includes('§19') || note.includes('kleinunternehmer')) return null;

  const hasRcPhrase = note.includes('reverse charge') || note.includes('§13b') ||
    note.includes('steuerschuldnerschaft');
  if (hasRcPhrase) return null;

  return finding('B-ZM-02', 'WARNING',
    [invoice.id].filter(Boolean),
    '§14a Abs. 5 UStG',
    { customer_country: customerCountry, vat_exempt_note: invoice.vat_exempt_note ?? null }
  );
}

// ---------------------------------------------------------------------------
// Main export: runBuchungspruefung(context) → findings[]
// ---------------------------------------------------------------------------
function runBuchungspruefung(context) {
  const {
    company          = null,
    business_context = null,
    invoice          = null,
    transaction      = null,
    entry            = null,
    recognized_data  = null,
  } = context ?? {};

  const findings = [
    checkA01(invoice, transaction),
    checkA02(invoice, entry),
    checkA05(company, invoice),
    checkA06(company, invoice),
    checkA10(transaction, entry),
    checkA12(invoice, entry),
    checkA09(invoice, recognized_data),
    checkB05(invoice, entry),
    checkB08(entry, company),
    checkBCat01(entry, invoice),
    checkBType01(invoice, entry, business_context),
    checkBZM01(invoice),
  ].filter(Boolean);

  return findings;
}

module.exports = {
  runBuchungspruefung,
  // Export individual checks for direct testing / orchestrator use
  checkA01, checkA02, checkA05, checkA06, checkA09, checkA10, checkA12, checkA15,
  checkB01, checkB05, checkB08, checkB09, checkBCat01, checkBKfz01, checkBType01, checkBZM01,
  checkA11, findDuplicateInvoices,
  checkB02, checkB03, checkBEUR02, checkBEUR03, checkBZM02,
  EU_COUNTRIES, afaRangeFor, amountMatch,
};
