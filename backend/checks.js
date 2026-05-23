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

  const reason = (invoice.vat_exempt_reason ?? '').toLowerCase();

  // Legitimate exemptions — do not flag
  if (reason.includes('reverse charge') || reason === 'reverse_charge') return null;
  if (reason.includes('§3a') || reason.includes('§4 ustg')) return null;
  if (reason.includes('drittland') || reason.includes('non-eu')) return null;

  // §19 on a Regelbesteuerer → ERROR
  if (reason.includes('§19') || reason.includes('kleinunternehmer')) {
    return finding('A-06', 'ERROR',
      [invoice.id].filter(Boolean),
      '§19 UStG',
      { vat_status: company.vat_status, vat_exempt_reason: invoice.vat_exempt_reason }
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
  const reason = (invoice.vat_exempt_reason ?? '').toLowerCase();
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
    checkA12(invoice, entry),
    checkA09(invoice, recognized_data),
    checkB05(invoice, entry),
    checkBCat01(entry, invoice),
    checkBType01(invoice, entry, business_context),
    checkBZM01(invoice),
  ].filter(Boolean);

  return findings;
}

module.exports = {
  runBuchungspruefung,
  // Export individual checks for direct testing
  checkA01, checkA02, checkA05, checkA06, checkA09, checkA12,
  checkB05, checkBCat01, checkBType01, checkBZM01,
  EU_COUNTRIES,
};
