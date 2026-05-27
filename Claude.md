# AI Tax Advisor — Phase 0 (MVP Concept Validation)

## What we're building

A standalone web application to validate the AI Tax Advisor concept with 7 beta clients.
This is NOT integrated into the production Finom app — it's an independent prototype.

**Goal:** Test whether the AI Tax Advisor finds real errors in real client accounting data,
and whether users trust and act on the findings.

## Key documentation files (read these first)

- `PRD_AI_Tax_Advisor.md` — Product requirements, Phase 0 hypotheses (H1–H8), UX variants
- `Technical_Spec.md` — Data schemas, agent tools, system prompt
- `Tax_Checks_Catalog.md` — 31 tax rules the agent must check
- `ARCHITECTURE.md` — Request flow, tool_use loop, threadId, API schemas
- `DEV_PLAN.md` — 5-phase development plan with test commands

## Tech stack

- **Backend:** Node.js + Express
- **Frontend:** React (Vite)
- **AI:** Anthropic API (Claude sonnet-4-6) with tool use
- **Mock data:** Separate JSON files per entity type (simulates production DB tables)
- **Deployment:** Vercel (frontend, static) + Railway (backend Express, no timeout limit)
- **Production URLs:** Frontend: https://ai-tax-advisor-mvp.vercel.app · Backend: https://aitaxadvisormvp-production.up.railway.app

---

## Data storage structure

Data is split into separate files — each simulates a production DB table.
Every record has a `client_id` field (foreign key). Tools filter by `client_id` + optional period.

```
backend/data/
├── clients.json                ← [{id, display_name}]
├── company_settings.json       ← [{client_id, legal_form, vat_status, ...}]
├── business_context.json       ← [{client_id, sales_channels, has_eu_b2b_clients, ...}]
├── transactions.json           ← [{client_id, id, date, amount, type, ...}]
├── invoices.json               ← [{client_id, id, type, amount_gross, vat_rate, ...}]
├── bookkeeping_entries.json    ← [{client_id, id, type, account_code, vat_rate, ...}]
├── assets.json                 ← [{client_id, id, name, amortization_period_years, ...}]
├── reports_eur.json            ← [{client_id, id, year, home_office, ...}]
├── reports_ustva.json          ← [{client_id, id, period, net_vat_payable, ...}]
├── reports_zm.json             ← [{client_id, id, period, eu_customers, ...}]
├── reports_gewst.json          ← [{client_id, id, year, gewst_payable, ...}]
├── tasks.json                  ← [{client_id, id, type, status, due_date, ...}]
├── invoice_categories.json     ← mock responses for categorize_invoice tool
├── expense_categories.json     ← production category list (94 entries): id, group_title, category_title, skr04, skr03, type
└── invoice_files/
    └── client_001/
        └── inv_001_006.pdf
```

---

## DATA CONVENTIONS — обязательно соблюдать

### 1. Три независимые сущности

Данные существуют в трёх отдельных слоях. Ошибка = расхождение между любыми двумя:

```
ТРАНЗАКЦИЯ          ←→    ИНВОЙС              ←→    БУХГАЛТЕРСКАЯ ПРОВОДКА
(банковая выписка)        (данные документа)         (учётная запись)
```

Никогда не смешивать поля разных сущностей. Если поле относится к инвойсу — оно только в инвойсе.

### 2. Транзакции — строго банковые поля

Транзакция = то, что видно в банковской выписке. Ничего больше.

**Разрешённые поля:**
```json
{
  "client_id": "client_001",
  "id": "txn_001_001",
  "date": "2026-01-10",
  "amount": 4200.00,
  "currency": "EUR",
  "counterparty": "TechCorp München GmbH",
  "payment_reference": "Honorar Januar 2026 / Rg. 2026-001",
  "type": "incoming",
  "linked_invoice_id": "inv_001_001"
}
```

**Запрещено добавлять в транзакции:**
- `vat_amount`, `net_amount`, `vat_rate` — НДС живёт в инвойсе и проводке
- `category` — категория живёт в проводке
- `notes` с комментариями об ошибках или бизнес-контексте
- `counterparty_country` — страна поставщика живёт в инвойсе

**Поле `type`:** только `"incoming"` (деньги пришли) или `"outgoing"` (деньги ушли).
Не использовать: `"income"`, `"expense"`, `"revenue"`, `"payment"`.

### 3. Ошибки в данных — только скрытые

Агент должен **самостоятельно** находить расхождения. Никаких подсказок в данных.

**Запрещено:**
```json
"notes": "⚠️ ОШИБКА: неверная ставка НДС"
"notes": "Возможно, нужен Reverse Charge"
"description": "ВНИМАНИЕ: расхождение с инвойсом"
```

**Правильно:** просто записать данные как есть. Ошибка видна через сравнение сущностей.

### 4. Поля бухгалтерских проводок

Каждая проводка обязана содержать следующие поля для проверки правильности:

| Поле | Тип | Описание |
|---|---|---|
| `reverse_charge_flag` | boolean | Применялся ли §13b UStG (Reverse Charge) |
| `service_type` | `"goods"` \| `"services"` \| null | Товар или услуга |
| `vat_rate_if_domestic` | 0.19 \| 0.07 \| 0.00 \| null | Ставка НДС при внутренней покупке |
| `transaction_subtype` | `"refund"` \| `"cashback"` \| null | Признак возврата/рефанда (обязателен для A-10) |

**Правило `transaction_subtype`:**
- Если транзакция является возвратом (Rückerstattung, Erstattung, refund) — проводка **обязана** содержать `"transaction_subtype": "refund"` или `"cashback"`
- Для всех обычных транзакций: `"transaction_subtype": null`
- Агент проверяет соответствие: `payment_reference` содержит ключевые слова возврата → `transaction_subtype` должен быть установлен (правило A-10)
- Кредит-ноты (Gutschrift / Stornorechnung) как отдельный тип документа **не поддерживаются** системой

Пример: поставщик из IE, счёт на 0% — это правильно (RC). Но `vat_rate_if_domestic = 0.19`, потому что без RC это был бы стандартный 19%.

### 5. Согласованность данных при изменении схемы

При добавлении нового поля в схему — обновить **все** существующие записи того же типа в том же коммите. Никаких записей, где новое поле отсутствует.

При изменении данных — обновить документацию в том же коммите (Technical_Spec.md или ARCHITECTURE.md).

### 6. Тест-кейсы: принцип построения

Каждый тест-кейс = ошибка видна только через сравнение двух сущностей.
Данные не содержат явных пометок об ошибке — агент должен найти расхождение самостоятельно.

#### Таблица покрытия по клиентам

| Клиент | Сценарий | Правило | Как скрыта ошибка |
|---|---|---|---|
| client_001 — Anna Müller, IT-Freelancer | Reverse Charge: поставщик из ЕС, RC не применён | A-12, A-02 | `entry_001_009`: reverse_charge_flag=false, vat_rate_if_domestic=0.19; `inv_001_006`: supplier_country=IE, vat_rate=0.00 |
| client_002 — Thomas Schneider, Grafikdesigner | Home Office Tagespauschale + расходы на Büroreinigung за тот же период | B-04 | `eur_002_2025`: home_office.method=tagespauschale; проводки SKR04-6330 (Büroreinigung) в том же году |
| client_003 — Maria Schmidt, Online-Shop/Amazon FBA | Комиссия Amazon не отражена отдельной проводкой | A-11 | Транзакция от Amazon на ~€820 (нетто после комиссии ~15%), инвойс покупателю на ~€965; разница ~€145 не проведена как Provision (SKR04 6300) |
| client_003 | + Возврат покупателю без Stornorechnung | A-10 | Входящая транзакция с payment_reference содержит "Rückerstattung" — нет Gutschrift с отрицательной суммой |
| client_004 — Peter Wagner, Unternehmensberater | Неверная страна поставщика → неверный НДС-режим | A-12 | Поставщик из PL: `entry_004_008` reverse_charge_flag=false, tax_residency_applied="domestic" — inv_004_006 указывает supplier_country="PL", VAT=0, RC |
| client_004 | + Неверный тип «товар/услуга» для EU B2B | B-Type-01 | IT-услуга от NL-контрагента: `entry_004_009` service_type="goods", reverse_charge_flag=false — нарушает §13b UStG |
| client_004 | + Ремонт BMW при отсутствии текущих расходов | B-Kfz-01 (WARNING) | `entry_004_kfz_repair` account_code=6570 (ремонт BMW). Нет записей 6520/6530/6540/6560. Актив BMW в assets.json есть → при 1%-Regelung отсутствие Kraftstoff подозрительно |
| client_005 — Lisa Braun, Fotografin | Оборудование > €800 нетто проведено как расход, актив не создан | B-EÜR-02 | Canon EOS R5: txn 2856 EUR (Foto Koch GmbH), inv net=2400+VAT=456. `entry_005_camera` account_code=6830; нет актива в assets.json |
| client_005 | + Неправдоподобный сплит (100% бизнес) | E-02 | `entry_005_phone`: is_private_use=true, private_use_split=0.00. `entry_005_internet`: private_use_split=0.00. home_address=work_address |
| client_005 | + Ремонт частного автомобиля как Betriebsausgabe | B-Kfz-01 (ERROR) | `entry_005_kfz_repair` account_code=6570 (ремонт авто ~320 EUR). Нет vehicle-актива в assets.json → фактические расходы на частный авто не вычитаются |
| client_006 — Michael Fischer, Software-Entwickler | Исходящий RC-инвойс к EU-клиенту без VAT ID | B-ZM-01 | Исходящий инвойс к AT-клиенту: vat_rate=0, RC, но customer_vat_id=null → ZM невозможна |
| client_006 | + Неверный период подачи UStVA | C-04 | company_settings.vat_report_period="quarterly". Годовой НДС (DE-клиенты, 19%) > €7 500 → обязательна ежемесячная подача |
| client_007 — Sarah Klein, Online-Yoga-Trainerin | Возврат не помечен в проводке | A-10 | `txn_007_007`: ref="Erstattung Yoga-Kurs März 2026". `entry_007_erstattung`: transaction_subtype=null вместо "refund" |
| client_007 | + Домашний интернет 100% бизнес при совмещённом адресе | E-02 | `entry_007_internet`: private_use_split=0.00, home_address=work_address в business_context |
| client_007 | + VAT-статус в настройках противоречит инвойсам | C-05 | company_settings.vat_status="Regelbesteuerer" (ошибка в анкете). Все исходящие инвойсы: vat_rate=0, vat_exempt_reason="§19 UStG". Реальный статус — Kleinunternehmerin |
| client_003 — Maria Schmidt, Amazon FBA | + Двунаправленные платежи Amazon: Auszahlung (входящий) + FBA-fee (исходящий) без отдельных проводок | E-09, A-11 | Amazon фигурирует как counterparty в обоих направлениях: incoming txn "Amazon Auszahlung" + outgoing txn "Amazon FBA Gebühren"; исходящая сумма не проведена отдельной расходной проводкой — скрытый нетто-зачёт |

#### Принцип скрытой ошибки

- Ошибка **никогда** не указана явно в данных (нет поля `"error": true`, нет notes с предупреждением)
- Ошибка **всегда** видна только через сравнение двух сущностей (транзакция ↔ инвойс, инвойс ↔ проводка, проводка ↔ настройки компании)
- Данные реалистичны: клиент «не заметил» ошибку, а не «намеренно ввёл неверные данные»
- Каждый клиент имеет минимум 1 основной сценарий; часть клиентов — 2 (основной + дополнительный)

---

## Agent tools — полный список

| Инструмент | `period` обязателен | Источник данных |
|---|---|---|
| `get_transactions(company_id, period?)` | нет | `transactions.json` |
| `get_invoices(company_id, period?)` | нет | `invoices.json` |
| `get_company_settings(company_id)` | — | `company_settings.json` |
| `get_business_context(company_id)` | — | `business_context.json` |
| `get_assets(company_id)` | — | `assets.json` |
| `get_bookkeeping_entries(company_id, period?)` | нет | `bookkeeping_entries.json` |
| `get_reports_eur(company_id, year?)` | нет | `reports_eur.json` |
| `get_reports_ustva(company_id, period?)` | нет | `reports_ustva.json` |
| `get_reports_zm(company_id, period?)` | нет | `reports_zm.json` |
| `get_reports_gewst(company_id, year?)` | нет | `reports_gewst.json` |
| `get_tasks(company_id)` | — | `tasks.json` |
| `recognize_invoice_document(invoice_id)` | — | `invoice_files/` → Claude Vision |
| `categorize_invoice(invoice_id, line_items)` | — | `invoice_categories.json` (mock) |
| `get_expense_categories(group?, skr04?)` | — | `expense_categories.json` (production list) |

**Важно:** `period` — необязательный параметр. Если не указан — возвращаются все записи за текущий год. Это нужно для поиска проводки, когда пользователь не знает точный период.

---

## Business context (CRITICAL for correct analysis)

Each client has a `business_context` record. The agent MUST load and apply this before running any checks. The same transaction can be correct or an error depending on the business model:

- `reverse_charge_applicable`: 0% VAT on outgoing invoices to EU B2B is CORRECT, not an error
- `oss_vat_registered`: affects EU B2C sales VAT obligations
- `uses_marketplace`: marketplace fees (Amazon, Upwork) are normal expense categories
- `has_ksk_membership`: affects social contributions analysis
- `has_company_car` + `company_car_details`: affects vehicle expense checks and 1%-Regel
- `works_from_home`: affects home office deduction checks

If business_context is missing or empty, the agent must warn:
"For more accurate analysis, please fill in your Business Profile in Settings."

---

## Tax checks to implement

See `Tax_Checks_Catalog.md` for all 39 rules across 6 blocks:
- **Block A:** Invoice ↔ stored data + document recognition (8 rules: A-01, A-02, A-05, A-06, A-09, A-10, A-11, A-12)
- **Block B-Core:** Accounting contradictions — always applicable (5 rules: B-01, B-05, B-08, B-Cat-01, B-09)
- **Block B-EÜR:** Issues affecting annual EÜR report (4 rules: B-EÜR-02, B-02, B-03, B-EÜR-01)
- **Block B-UStVA:** Issues affecting VAT return UStVA (6 rules: B-Type-01, B-04, B-06, B-07, B-UStVA-01, B-UStVA-02)
- **Block B-ZM:** Issues affecting EU B2B summary report ZM (2 rules)
- **Block C:** Settings/status contradictions (5 rules: C-01, C-02, C-04, C-Act-01, C-08)
- **Block E:** Logical consistency checks — second pass (9 rules: E-01 … E-09)

---

## Two-pass analysis approach

**Pass 1 — Formal checks (Blocks A, B, C):** deterministic rules against individual records.

**Pass 2 — Logical consistency (Block E):** patterns across all records.
- Private use split ratios consistent?
- Expense proportions within industry norms (Richtsätze BMF)?
- Round-number entries suggest Schätzung risk?
- Car expenses present but no vehicle asset registered?
- Year-end expense spike?

Pass 2 findings are labelled separately so users understand the difference between
"this is wrong" and "this looks unusual."

---

## Invoice file storage

Invoice files: `backend/data/invoice_files/{client_id}/{invoice_id}.pdf`
Each invoice record has `file_path` and `file_available: boolean`.
If `file_available == false` — skip check A-09, do NOT generate a false positive.

---

## Knowledge base

`knowledge_base/` — focused reference files loaded into system prompt at startup:
- `Finanzamt_Methodology_Reference.md` — audit methods, RMS, Richtsätze (EXISTS)
- `Tax_Thresholds_Current.md` — KU limit, GWG, Pauschalen (TO CREATE)
- `SKR04_Account_Plan.md` — SKR-04 chart of accounts (TO CREATE)
- `VAT_Rules_Reference.md` — §14/§19 UStG, Reverse Charge, ZM rules (TO CREATE)
- `Depreciation_AfA_Reference.md` — AfA tables, 1%-rule, GWG (TO CREATE)
- `Deduction_Rules_Reference.md` — §4 Abs. 5 EStG, Bewirtung, Home Office (TO CREATE)
- `Report_Forms_Reference.md` — UStVA, EÜR, ZM form structures (TO CREATE)

---

## Agent system prompt (core instructions)

```
You are an AI Tax Advisor assistant in Finom, a German accounting app for Einzelunternehmer.
Analyze the client's accounting data for the requested period and identify errors, contradictions, and risks.

STYLE:
- Be specific: reference exact transaction IDs, invoice numbers, amounts, dates
- Classify severity: ERROR (clear violation), WARNING (risk/uncertainty), OK (correct)
- For each issue: what's wrong → why it matters → what to do
- No legal jargon without explanation
- If data is insufficient to conclude — say so, don't guess

LEGAL FRAMEWORK:
- German tax law: EStG, UStG, GewStG
- Target clients: Einzelunternehmer (Freiberufler, Gewerbetreibender within EÜR limits)
- Accounting method: Einnahmenüberschussrechnung (EÜR), cash basis
- VAT: standard 19%/7%, or Kleinunternehmerregelung (§19 UStG)

IMPORTANT:
- You are NOT a licensed Steuerberater
- Your findings are informational only
- For complex situations, recommend consulting a specialist

OUTPUT FORMAT:
Return structured JSON: { errors[], warnings[], ok_checks[], steuerreserve }
Each item: { id, title, description, affected_items[], recommendation }
Then render as readable report.
```

---

## Hypotheses to validate (Phase 0)

| # | Hypothesis | Success criterion |
|---|---|---|
| H1 | Real client accounts contain findable errors | ≥7/10 clients have ≥1 actionable finding |
| H2 | Users understand ERROR vs WARNING without explanation | ≥8/10 interpret severity correctly |
| H3 | Users trust findings enough to act | ≥6/10 say "I'll fix/check this" |
| H4 | Users feel more confident after review | Measured before/after survey (1–5 scale) |
| H5 | Widget vs Chat: one format wins on engagement | Compare time-on-screen, action rate |
| H6 | Steuerreserve perceived as valuable | ≥7/10 rate as "important" or "very important" |
| H7 | Acceptable false positive rate | Determine max wrong findings before trust breaks |
| H8 | Users know next steps after seeing report | ≥7/10 name a next action unprompted |

---

## Three UX variants

Switch via URL query parameter:

| Variant | URL | Description |
|---|---|---|
| **Widget** (default) | `?variant=widget` | User-initiated analysis. Dropdown → "Check my books" → structured report (Errors / Warnings / OK / Steuerreserve) |
| **Chat** | `?variant=chat` | Conversational interface for multi-turn dialog with the agent |
| **Booking check** | `?variant=booking` | Synchronous quality gate for a single bookkeeping entry. Uses `POST /api/booking-check` (no agent loop — deterministic checks + optional LLM narration) |

---

## Backend endpoints

| Endpoint | Handler | Description |
|---|---|---|
| `GET /api/clients` | `server.js` | List all clients (id + display_name) |
| `POST /api/analyze` | `agent.js` | Full AI analysis — tool_use loop, returns JSON report |
| `POST /api/booking-check` | `backend/booking_check.js` | Synchronous booking quality gate. 10 deterministic rules in `backend/checks.js`. LLM called only when findings exist (≤ 2s clean path) |

---

## Development notes

- Keep mock data realistic — messy real-world data, not clean synthetic data
- Anthropic API key: set in `backend/.env` as `ANTHROPIC_API_KEY=sk-ant-...` AND in Railway environment variables
- DO NOT commit `backend/.env` to git; `frontend/.env.production` (Railway URL, no secrets) IS committed
- Target model: claude-sonnet-4-6
- System prompt is cached (`cache_control: ephemeral`) to avoid re-sending ~25k tokens each iteration
- Rate limit (429) handled with exponential backoff: 15s base, 4 attempts max

## Key commands

```bash
npm install          # Install dependencies
npm run server       # Start backend (port 3001)
npm run client       # Start frontend (port 5173)
npm run dev          # Start both
npm run test:tools   # Run tools unit tests (44 tests)
npm run test:agent   # Run agent test (client_001 Q1 2026)
node backend/test_all_clients.js  # Run all 7 clients — saves test_results.json
node backend/test_booking_check.js  # Test booking check (6 scenarios)
```
