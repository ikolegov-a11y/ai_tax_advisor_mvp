# AI Tax Advisor MVP — Test Cases

**Version:** 1.0  
**Created:** May 2026  
**Phase:** 5.5 — Formal test case documentation  
**Status:** Ready for Phase 6 validation run

---

## Overview

This document defines the formal test cases for validating the AI Tax Advisor agent against
all 7 mock clients. Each test case specifies:
- Which client and period to use
- What user query to send
- Which check IDs the agent MUST find (pass criterion)
- Which check IDs the agent MUST NOT flag as errors (false positive guard)
- Expected reasoning steps

**Pass criterion (global):** ≥ 6/7 clients find ≥ 1 expected error. False positive rate < 30%.

---

## Embedded errors summary

| Client | Errors (🔴) | Warnings (🟡) | Total findings |
|--------|-------------|---------------|----------------|
| client_001 | A-12 | — | 1 |
| client_002 | — | B-04 | 1 |
| client_003 | A-11, A-10 | E-09 | 3 |
| client_004 | A-12, B-Type-01 | B-Kfz-01 | 3 |
| client_005 | B-EÜR-02, B-Kfz-01 | E-02 | 3 |
| client_006 | B-ZM-01 | C-04 | 2 |
| client_007 | A-10, C-05 | E-02 | 3 |

---

## TC-001: Reverse Charge Not Applied — Incoming EU Invoice

**Client:** client_001 — Anna Müller, IT-Beratung  
**Period:** `Full Year 2026` (error is in April 2026 — outside Q1)  
**User query:** `"Check my books for errors, especially EU invoices"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| A-12 | ERROR 🔴 | Reverse Charge nicht angewendet | ✅ MUST find |

### Affected data items
- `inv_001_006` — OpenAI invoice, supplier_country="IE" (Ireland), vat_rate=0
- `txn_001_009` — payment €19.33
- `entry_001_009` — reverse_charge_flag=false, vat_rate_if_domestic=0.19 ← **the error**

### What the agent must reason
1. Load `get_business_context` → `reverse_charge_applicable=true` (EU B2B clients)
2. Find `entry_001_009` with `reverse_charge_flag=false` for an EU supplier
3. Cross-reference `inv_001_006`: supplier_country="IE", supplier_vat_id="IE4143435AH"
4. Conclude: §13b UStG requires reverse charge — entry is wrong

### Pass criterion
Agent response contains `"A-12"` in `errors[]` with reference to `entry_001_009` or `inv_001_006`.

### False positive guard
Agent must NOT flag Anna's outgoing invoices with 0% VAT as errors (she is Kleinunternehmer — §19 UStG, zero VAT on outgoing invoices is correct).

---

## TC-002: Home Office + Büroreinigung Double Deduction

**Client:** client_002 — Thomas Schneider, Grafikdesigner  
**Period:** `Full Year 2025`  
**User query:** `"Überprüfe meine Buchhaltung auf Fehler und Unstimmigkeiten"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| B-04 | WARNING 🟡 | Homeoffice-Pauschale + Büroreinigung gleichzeitig | ✅ MUST find |

### Affected data items
- `txn_002_c1_2025`, `_c2_2025`, `_c3_2025`, `_c4_2025` — quarterly Büroreinigung payments totaling €571.20
- `entry_002_clean_2025_q1` through `_q4` — account_code=6330, all four quarters
- `company_settings` → works_from_home=true, home_office_room_sqm=12

### What the agent must reason
1. Load `get_business_context` → `works_from_home=true`
2. Find expense entries with account_code=6330 (Büroreinigung) — four quarterly payments
3. Note that home office exists (12 sqm) → Tagespauschale may also be claimed
4. Flag: cannot deduct both Tagespauschale AND actual home office cleaning costs

### Pass criterion
Agent response contains `"B-04"` in `warnings[]` with reference to Büroreinigung entries or account 6330.

### False positive guard
Agent must NOT flag Thomas's 19% VAT on invoices as an error (he is Regelbesteuerer — charging VAT is correct).

---

## TC-003: Amazon FBA — Fee Not Separately Expensed + Refund Not Marked

**Client:** client_003 — Maria Schmidt, Amazon FBA / Online-Shop  
**Period:** `Q1 2026`  
**User query:** `"Check my Q1 books — I had a refund and marketplace fees"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| A-11 | ERROR 🔴 | Amazon-Provision nicht als separater Aufwand | ✅ MUST find |
| A-10 | ERROR 🔴 | Rückerstattung nicht als Refund markiert | ✅ MUST find |
| E-09 | WARNING 🟡 | Bidirektionale Buchungen ohne Netting-Kontrolle | optional |

### Affected data items

**For A-11:**
- `txn_003_008` — Amazon settlement €820 incoming (March 2026)
- `inv_003_008` — gross amount €967.60, net €813.11
- Expected commission ~€147 — no corresponding separate expense entry in SKR04 6300

**For A-10:**
- `txn_003_009` — incoming €89, payment_reference contains "Rückerstattung"
- `entry_003_009` — transaction_subtype=null ← **the error** (should be "refund")

### What the agent must reason
1. Compare settlement transaction amount vs invoice gross → gap identifies unexpensed fee
2. Find transaction with "Rückerstattung" in payment_reference
3. Check `entry_003_009.transaction_subtype` → null (missing refund marker)
4. Flag both as errors

### Pass criterion
Agent response contains `"A-11"` AND `"A-10"` in `errors[]`. A-10 must reference `entry_003_009` or `txn_003_009`.

### False positive guard
Agent must NOT flag OSS VAT on EU B2C sales as errors (oss_vat_registered=true → correct).

---

## TC-004: Reverse Charge Wrong Country + Service Type Mismatch

**Client:** client_004 — Peter Wagner, Unternehmensberatung  
**Period:** `Q1 2026`  
**User query:** `"Check my Q1 EU invoices and company car bookings"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| A-12 | ERROR 🔴 | EU-Eingangsrechnung ohne Reverse Charge (Polen) | ✅ MUST find |
| B-Type-01 | ERROR 🔴 | Leistungsart falsch klassifiziert (NL Software) | ✅ MUST find |
| B-Kfz-01 | WARNING 🟡 | KFZ-Reparatur ohne laufende Betriebskosten | optional |

### Affected data items

**For A-12:**
- `inv_004_006` — Progmatic Sp. z o.o. (Poland, PL7272543210), €357, supplier_country="PL"
- `entry_004_008` — tax_residency_applied="domestic", reverse_charge_flag=false ← **the error**

**For B-Type-01:**
- `inv_004_007` — CloudPlatform B.V. (Netherlands, NL855234567B01), €178.50, vat_rate=0
- `entry_004_009` — service_type="goods" ← **the error** (should be "services"); account_code=6815

**For B-Kfz-01 (optional):**
- `entry_004_006` — BMW repair €2980, account_code=6570
- Missing: entries for 6540 (fuel), 6520 (insurance), 6530 (tax) in Q1 2026

### What the agent must reason
1. Find `entry_004_008`: domestic treatment for Polish supplier → must be EU Reverse Charge
2. Find `entry_004_009`: service_type="goods" for software platform subscription from Netherlands → wrong classification
3. Check vehicle entries: repair present, but no operational costs → unusual pattern

### Pass criterion
Agent response contains `"A-12"` AND `"B-Type-01"` in `errors[]`.

### False positive guard
Agent must NOT flag the 1%-Regel Privatanteil entry for the BMW as an error (it is correctly applied per company settings).

---

## TC-005: Equipment Not Capitalized + Private Car Repair Without Asset

**Client:** client_005 — Lisa Braun, Fotografin  
**Period:** `Q1 2026`  
**User query:** `"Prüfe meine Buchungen — ich habe eine teure Kamera und Autokosten"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| B-EÜR-02 | ERROR 🔴 | Anlagegut >€800 nicht aktiviert (Kamera) | ✅ MUST find |
| B-Kfz-01 | ERROR 🔴 | KFZ-Reparatur ohne registriertes Fahrzeug | ✅ MUST find |
| E-02 | WARNING 🟡 | Privatanteil 0% für Telefon und Internet unrealistisch | optional |

### Affected data items

**For B-EÜR-02:**
- `entry_005_camera` — Canon EOS R5 Mark II, €2856 gross (€2400 net), account_code=6830 (expensed directly)
- `txn_005_008` — payment €2856 (March 2026)
- `inv_005_007` — €2856
- assets.json for client_005 — no camera asset ← **the error**

**For B-Kfz-01:**
- `entry_005_kfz_repair` — auto repair €320, account_code=6570
- `txn_005_011`, `inv_005_009` — match €320
- assets.json for client_005 — no vehicle registered ← **the error**

**For E-02 (optional):**
- `entry_005_phone` — private_use_split=0.0 for mobile phone
- `entry_005_internet` — private_use_split=0.0 for DSL internet

### What the agent must reason
1. Find camera purchase > €800 net → must be capitalized, not expensed → check assets list → no camera asset
2. Find vehicle repair expense → check assets list → no vehicle registered → repairs not deductible without business vehicle
3. Find phone/internet entries with 0% private use → flag as implausible without documentation

### Pass criterion
Agent response contains `"B-EÜR-02"` AND `"B-Kfz-01"` in `errors[]`. B-EÜR-02 must reference the camera amount (€2400 net or €2856 gross).

### False positive guard
Agent must NOT flag Lisa's Kleinunternehmer invoices (0% VAT, §19 UStG) as errors.

---

## TC-006: EU Invoice Without VAT ID + Wrong UStVA Frequency

**Client:** client_006 — Michael Fischer, Software-Entwickler  
**Period:** `Q1 2026`  
**User query:** `"Check my Q1 books — I have EU clients and just filed UStVA"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| B-ZM-01 | ERROR 🔴 | EU-Ausgangsrechnung ohne Kunden-USt-IdNr. | ✅ MUST find |
| C-04 | WARNING 🟡 | UStVA-Zeitraum falsch: Quartal statt Monat | ✅ MUST find |

### Affected data items

**For B-ZM-01:**
- `inv_006_003` — TechSolutions Wien GmbH (Austria, AT), €6000, vat_rate=0, vat_exempt_note=Reverse Charge
- `txn_006_003` — €6000
- `entry_006_003` — reverse_charge_flag=false, customer_vat_id=null ← **the error**

**For C-04:**
- `company_settings` → vat_report_period="quarterly"
- `reports_ustva` → `ustva_006_2025_annual`: total_vat_collected=€9310 (>€7500 threshold)
- Note in report: "wäre monatliche Voranmeldung für 2026 erforderlich"
- `ustva_006_2026_q1` — draft quarterly report (wrong — should be monthly)

### What the agent must reason
1. Find `inv_006_003`: EU B2B, Reverse Charge, customer_country="AT" → check customer_vat_id → null → ZM will fail
2. Load UStVA reports → 2025 total VAT = €9310 → exceeds €7500 threshold → 2026 requires monthly filing
3. Check current setting: vat_report_period="quarterly" → contradiction with legal requirement

### Pass criterion
Agent response contains `"B-ZM-01"` in `errors[]` AND `"C-04"` in `warnings[]` (or errors).
B-ZM-01 must reference the Austrian invoice or customer VAT ID issue.
C-04 must reference the €7500 threshold or the 2025 total VAT amount.

### False positive guard
Agent must NOT flag Michael's 0% Reverse Charge outgoing invoices to EU clients as errors (he has EU B2B clients, reverse_charge_applicable=true, and valid customer VAT IDs on other invoices).

---

## TC-007: VAT Status Contradiction + Refund Not Marked

**Client:** client_007 — Sarah Klein, Online-Yoga-Trainerin  
**Period:** `Q1 2026`  
**User query:** `"Überprüfe meine Buchungen auf Fehler — besonders meine Rechnungen und Erstattungen"`

### Expected findings

| Check ID | Severity | Title | Pass required? |
|----------|----------|-------|----------------|
| C-05 | ERROR 🔴 | USt-Status Widerspruch: Regelbesteuerer vs. §19 UStG | ✅ MUST find |
| A-10 | ERROR 🔴 | Erstattung nicht als Refund markiert | ✅ MUST find |
| E-02 | WARNING 🟡 | 100% Geschäftsanteil Internet unrealistisch | optional |

### Affected data items

**For C-05:**
- `company_settings` → vat_status="Regelbesteuerer", vat_id=null ← **the error**
- `inv_007_010`, `inv_007_011` — both vat_rate=0, vat_exempt_note="Gemäß §19 UStG..."
- All revenue entries: vat_rate=0.0, vat_exempt_reason="§19 UStG"
- Contradiction: Regelbesteuerer + §19 UStG exemption note = impossible combination

**For A-10:**
- `txn_007_007` — outgoing €120, payment_reference="Erstattung Yoga-Kurs März 2026"
- `entry_007_erstattung` — transaction_subtype=null ← **the error** (should be "refund")

**For E-02 (optional):**
- `entry_007_internet` — DSL €44.99, private_use_split=0.0 for home-based instructor

### What the agent must reason
1. Load company settings → vat_status="Regelbesteuerer"
2. Load invoices → all show §19 UStG exemption phrase → contradiction with Regelbesteuerer status
3. Note vat_id=null (Regelbesteuerer must have VAT ID) → confirms the status is wrong
4. Find transaction with "Erstattung" in reference → check entry → transaction_subtype=null

### Pass criterion
Agent response contains `"C-05"` AND `"A-10"` in `errors[]`.
C-05 must reference the vat_status contradiction (Regelbesteuerer vs §19 UStG phrase).
A-10 must reference `entry_007_erstattung` or `txn_007_007`.

### False positive guard
Agent must NOT flag Sarah's digital goods sales as OSS violations (she has no international customers — sales are domestic only).

---

## How to run the tests (Phase 6)

### Option A — Direct agent call (no HTTP, cheapest)
```bash
# From project root
node backend/test_all_clients.js
# Saves results to backend/test_results.json
```

### Option B — curl against local server
```bash
# Start server first: npm run server
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client_001","period":"Full Year 2026","userQuery":"Check my books for errors, especially EU invoices"}'
```

### Option C — Production smoke test (costs ~$1.50 per client)
```bash
curl -X POST https://ai-tax-advisor-mvp.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -H "Origin: https://ai-tax-advisor-mvp.vercel.app" \
  -d '{"clientId":"client_001","period":"Full Year 2026","userQuery":"Check my books for errors"}'
```

---

## Acceptance criteria for Phase 6 completion

| Criterion | Target | Method |
|-----------|--------|--------|
| Required errors found | ≥ 12/16 (75%) | Check each MUST find entry |
| False positives | < 30% of total findings | Count unexpected errors |
| No client 100% missed | Every client has ≥ 1 finding | Check per-client results |
| Production response time | < 60 seconds | `curl --trace-time` |
| UI renders without console errors | Zero JS errors | Chrome DevTools |

If all criteria met → ready to invite first 10 beta users.

---

## Error data reference

The table below maps each embedded error to its source data for quick cross-check during analysis.

| Check ID | Client | Source field | Value | Expected value |
|----------|--------|-------------|-------|----------------|
| A-12 (001) | client_001 | entry_001_009.reverse_charge_flag | false | true |
| A-12 (001) | client_001 | entry_001_009.vat_rate_if_domestic | 0.19 | 0 |
| B-04 | client_002 | entry_002_clean_*.account_code | 6330 × 4 | — (flag for double deduction) |
| A-11 | client_003 | entry_003_008.linked_fee_id | null | separate fee entry |
| A-10 (003) | client_003 | entry_003_009.transaction_subtype | null | "refund" |
| A-12 (004) | client_004 | entry_004_008.tax_residency_applied | "domestic" | "eu" |
| A-12 (004) | client_004 | entry_004_008.reverse_charge_flag | false | true |
| B-Type-01 | client_004 | entry_004_009.service_type | "goods" | "services" |
| B-EÜR-02 | client_005 | entry_005_camera.account_code | 6830 | asset (not expensed) |
| B-Kfz-01 (005) | client_005 | assets[vehicle] | missing | vehicle asset required |
| B-ZM-01 | client_006 | inv_006_003.customer_vat_id | null | valid ATU... ID |
| C-04 | client_006 | company_settings.vat_report_period | "quarterly" | "monthly" |
| C-05 | client_007 | company_settings.vat_status | "Regelbesteuerer" | "Kleinunternehmer" |
| A-10 (007) | client_007 | entry_007_erstattung.transaction_subtype | null | "refund" |
