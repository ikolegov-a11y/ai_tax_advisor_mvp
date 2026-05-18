#!/usr/bin/env node
/**
 * validate_data.js — Data consistency validator for AI Tax Advisor test dataset
 *
 * Checks:
 *  1. All linked_invoice_id values exist in invoices.json
 *  2. All linked_transaction_id values exist in transactions.json
 *  3. All linked_asset_id values exist in assets.json
 *  4. invoice.vat_amount ≈ gross - net (±0.02 tolerance)
 *  5. entry.vat_amount ≈ gross - net (±0.02 tolerance)
 *  6. Every transaction has at least one bookkeeping entry
 *  7. Every asset with purchase_price > 800 has at least one depreciation entry
 *  8. ID formats are correct (txn_NNN_XXX, inv_NNN_XXX, entry_NNN_XXX)
 *  9. All dates are valid YYYY-MM-DD and entry.date is within ±5 days of its txn.date
 * 10. Transaction type is only "incoming" or "outgoing"
 *
 * Intentional errors (A-10, A-11, A-12, B-Cat-01, B-EÜR-02, B-Type-01, C-Act-01, E-02)
 * are cross-layer contradictions — they will NOT appear as validation errors here.
 * This script only checks internal consistency (broken IDs, bad math, wrong formats).
 *
 * Usage: node backend/validate_data.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function load(file) {
  const filePath = path.join(DATA_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`❌ Failed to load ${file}: ${e.message}`);
    process.exit(1);
  }
}

// ── Load all files ─────────────────────────────────────────────────────────
const transactions = load('transactions.json');
const invoices     = load('invoices.json');
const entries      = load('bookkeeping_entries.json');
const assets       = load('assets.json');

// ── Build lookup sets ──────────────────────────────────────────────────────
const txnById     = new Map(transactions.map(t => [t.id, t]));
const invById     = new Map(invoices.map(i => [i.id, i]));
const assetById   = new Map(assets.map(a => [a.id, a]));

// IDs of transactions that have at least one entry
const txnWithEntry = new Set();

let errors = 0;
let warnings = 0;

function err(msg) {
  console.error(`  ❌ ERROR: ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`  ⚠️  WARN:  ${msg}`);
  warnings++;
}

function ok(msg) {
  console.log(`  ✅ OK:    ${msg}`);
}

function checkVat(obj, label) {
  const gross = obj.amount_gross ?? 0;
  const net   = obj.amount_net   ?? 0;
  const vat   = obj.vat_amount   ?? 0;
  const computed = Math.round((gross - net) * 100) / 100;
  const diff = Math.abs(computed - vat);
  if (diff > 0.02) {
    err(`${label} [${obj.id}]: vat_amount ${vat} ≠ gross(${gross}) - net(${net}) = ${computed} (diff ${diff.toFixed(2)})`);
  }
}

function parseDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const d = new Date(str + 'T00:00:00Z');
  return isNaN(d) ? null : d;
}

// ── Intentional-error allowlist ────────────────────────────────────────────
// These linked_invoice_id=null cases are INTENTIONAL for A-10 checks.
// Do not flag them as missing-invoice errors.
const intentionalNoInvoice = new Set([
  'txn_003_009',  // A-10: Rückerstattung without Stornorechnung
  'txn_007_007',  // A-10: Erstattung Yoga-Kurs without Gutschrift
]);

// ── Check 1–3: Referential integrity on invoices ───────────────────────────
console.log('\n── Check 1: linked_invoice_id references ─────────────────────────────────');
for (const txn of transactions) {
  if (txn.linked_invoice_id) {
    if (!invById.has(txn.linked_invoice_id)) {
      err(`txn ${txn.id}: linked_invoice_id "${txn.linked_invoice_id}" not found in invoices.json`);
    }
  }
}
for (const inv of invoices) {
  if (inv.linked_transaction_id) {
    if (!txnById.has(inv.linked_transaction_id)) {
      err(`inv ${inv.id}: linked_transaction_id "${inv.linked_transaction_id}" not found in transactions.json`);
    }
  }
}
if (errors === 0) ok('All invoice ↔ transaction cross-references valid');

console.log('\n── Check 2: bookkeeping_entry references ─────────────────────────────────');
for (const entry of entries) {
  if (entry.linked_invoice_id && !invById.has(entry.linked_invoice_id)) {
    err(`entry ${entry.id}: linked_invoice_id "${entry.linked_invoice_id}" not found`);
  }
  if (entry.linked_transaction_id) {
    if (!txnById.has(entry.linked_transaction_id)) {
      err(`entry ${entry.id}: linked_transaction_id "${entry.linked_transaction_id}" not found`);
    } else {
      txnWithEntry.add(entry.linked_transaction_id);
    }
  }
  if (entry.linked_asset_id && !assetById.has(entry.linked_asset_id)) {
    err(`entry ${entry.id}: linked_asset_id "${entry.linked_asset_id}" not found`);
  }
}
if (errors === 0) ok('All entry cross-references valid');

// ── Check 4: Invoice VAT math ──────────────────────────────────────────────
console.log('\n── Check 4: Invoice VAT arithmetic ───────────────────────────────────────');
let vatErrBefore = errors;
for (const inv of invoices) {
  checkVat(inv, 'invoice');
}
if (errors === vatErrBefore) ok('All invoice VAT amounts correct');

// ── Check 5: Entry VAT math ────────────────────────────────────────────────
console.log('\n── Check 5: Entry VAT arithmetic ─────────────────────────────────────────');
vatErrBefore = errors;
for (const entry of entries) {
  checkVat(entry, 'entry');
}
if (errors === vatErrBefore) ok('All entry VAT amounts correct');

// ── Check 6: Every transaction has at least one entry ──────────────────────
console.log('\n── Check 6: Transaction coverage ─────────────────────────────────────────');
let missingEntry = 0;
for (const txn of transactions) {
  if (!txnWithEntry.has(txn.id)) {
    // Intentional no-invoice cases still need an entry (the entry just has no invoice)
    warn(`txn ${txn.id} (${txn.client_id}, ${txn.date}, ${txn.amount} ${txn.type}): no bookkeeping entry`);
    missingEntry++;
  }
}
if (missingEntry === 0) ok('Every transaction has at least one bookkeeping entry');

// ── Check 7: Assets with purchase_price > 800 have depreciation entries ────
console.log('\n── Check 7: Asset depreciation entries ────────────────────────────────────');
const depreciationAssets = new Set(
  entries.filter(e => e.type === 'depreciation' && e.linked_asset_id).map(e => e.linked_asset_id)
);
for (const asset of assets) {
  if ((asset.purchase_price ?? 0) > 800 && !depreciationAssets.has(asset.id)) {
    err(`asset ${asset.id} (${asset.name}, €${asset.purchase_price}): no depreciation entry found`);
  }
}
if (errors === 0) ok('All depreciable assets have depreciation entries');

// ── Check 8: ID formats ────────────────────────────────────────────────────
console.log('\n── Check 8: ID format validation ─────────────────────────────────────────');
const txnPattern   = /^txn_\d{3}_\w+$/;
const invPattern   = /^inv_\d{3}_\w+$/;
const entryPattern = /^entry_\d{3}_\w+$/;
const assetPattern = /^asset_\d{3}_\w+$/;
let fmtErrBefore = errors;
for (const t of transactions) if (!txnPattern.test(t.id))   err(`txn ID format invalid: "${t.id}"`);
for (const i of invoices)     if (!invPattern.test(i.id))   err(`inv ID format invalid: "${i.id}"`);
for (const e of entries)      if (!entryPattern.test(e.id)) err(`entry ID format invalid: "${e.id}"`);
for (const a of assets)       if (!assetPattern.test(a.id)) err(`asset ID format invalid: "${a.id}"`);
if (errors === fmtErrBefore) ok('All IDs match expected format');

// ── Check 9: Date formats and entry ≈ txn date ±5 days ────────────────────
console.log('\n── Check 9: Date validation ───────────────────────────────────────────────');
let dateErrBefore = errors;
for (const t of transactions) {
  if (!parseDate(t.date)) err(`txn ${t.id}: invalid date "${t.date}"`);
}
for (const i of invoices) {
  if (!parseDate(i.date)) err(`inv ${i.id}: invalid date "${i.date}"`);
}
for (const e of entries) {
  if (!parseDate(e.date)) {
    err(`entry ${e.id}: invalid date "${e.date}"`);
    continue;
  }
  if (e.linked_transaction_id && txnById.has(e.linked_transaction_id)) {
    const txnDate   = parseDate(txnById.get(e.linked_transaction_id).date);
    const entryDate = parseDate(e.date);
    if (txnDate && entryDate) {
      const diffDays = Math.abs((entryDate - txnDate) / 86400000);
      if (diffDays > 5) {
        warn(`entry ${e.id}: date ${e.date} is ${diffDays.toFixed(0)} days away from txn date ${txnById.get(e.linked_transaction_id).date}`);
      }
    }
  }
}
if (errors === dateErrBefore) ok('All dates valid');

// ── Check 10: Transaction type values ──────────────────────────────────────
console.log('\n── Check 10: Transaction type values ──────────────────────────────────────');
let typeErrBefore = errors;
for (const t of transactions) {
  if (t.type !== 'incoming' && t.type !== 'outgoing') {
    err(`txn ${t.id}: invalid type "${t.type}" — must be "incoming" or "outgoing"`);
  }
}
if (errors === typeErrBefore) ok('All transaction types valid');

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(`Transactions:        ${transactions.length}`);
console.log(`Invoices:            ${invoices.length}`);
console.log(`Bookkeeping entries: ${entries.length}`);
console.log(`Assets:              ${assets.length}`);
console.log('──────────────────────────────────────────────────────────────────────────');
if (errors === 0 && warnings === 0) {
  console.log('✅ ALL CHECKS PASSED — dataset is internally consistent');
} else {
  if (errors > 0)   console.error(`❌ ${errors} ERROR(s) found — fix before testing`);
  if (warnings > 0) console.warn(`⚠️  ${warnings} WARNING(s) — review recommended`);
}
console.log('══════════════════════════════════════════════════════════════════════════\n');

process.exit(errors > 0 ? 1 : 0);
