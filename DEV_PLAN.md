# AI Tax Advisor MVP — Development Plan

**Created:** May 2026  
**Based on:** CLAUDE.md, PRD_AI_Tax_Advisor.md, Technical_Spec.md, Tax_Checks_Catalog.md,
knowledge_base/Finanzamt_Methodology_Reference.md, PROJECT_LOG.md

---

## 1. Full Project File Structure

```
ai-tax-advisor.MVP/
│
├── CLAUDE.md                               ← project context for Claude Code
├── PRD_AI_Tax_Advisor.md                   ← product requirements
├── Technical_Spec.md                       ← architecture & data schemas
├── Tax_Checks_Catalog.md                   ← 25 tax rules (Blocks A/B/C)
├── DEV_PLAN.md                             ← this file
├── ARCHITECTURE.md                         ← to be created at Checkpoint 2
├── PROJECT_LOG.md                          ← progress log
│
├── knowledge_base/
│   ├── Finanzamt_Methodology_Reference.md  ← EXISTS: audit methods, ELSTER RMS, Richtsätze
│   ├── Tax_Thresholds_Current.md           ← TO CREATE: KU limit, GWG, Pauschalen, AfA-Tabellen
│   ├── SKR04_Account_Plan.md               ← TO CREATE: chart of accounts SKR-04
│   ├── VAT_Rules_Reference.md              ← TO CREATE: §14/§19 UStG, Reverse Charge, ZM
│   ├── Depreciation_AfA_Reference.md       ← TO CREATE: AfA full tables, 1%-Firmenwagen, GWG
│   ├── Deduction_Rules_Reference.md        ← TO CREATE: §4 Abs. 5 EStG, Bewirtung, Home Office
│   └── Report_Forms_Reference.md           ← TO CREATE: UStVA/EÜR/ZM form structures, Kennzahlen
│
├── backend/
│   ├── data/
│   │   ├── client_001.json                 ← mock data: Anna Müller (IT-Freelancer)
│   │   ├── client_002.json                 ← mock data: client 2
│   │   ├── client_003.json                 ← mock data: client 3
│   │   ├── client_004.json                 ← mock data: client 4
│   │   ├── client_005.json                 ← mock data: client 5
│   │   ├── client_006.json                 ← mock data: client 6
│   │   ├── client_007.json                 ← mock data: client 7
│   │   └── invoice_files/
│   │       ├── client_001/
│   │       │   ├── inv_001_001.pdf         ← actual invoice document
│   │       │   ├── inv_001_008.pdf         ← intentional mismatch (A-09 test)
│   │       │   └── inv_001_008_recognized.json  ← pre-computed OCR fallback
│   │       └── client_002/ ... client_007/
│   │
│   ├── tools.js                            ← Phase 1: 9 mock data access functions
│   ├── agent.js                            ← Phase 2: Claude API + tool_use loop
│   ├── server.js                           ← Phase 3: Express API server
│   ├── test_tools.js                       ← Phase 1 test script
│   └── test_agent.js                       ← Phase 2 test script
│
├── frontend/
│   ├── index.html                          ← Phase 4: Vite entry point
│   ├── package.json                        ← frontend deps (vite, react)
│   └── src/
│       ├── main.jsx                        ← React bootstrap
│       ├── App.jsx                         ← root component + routing by ?variant
│       ├── components/
│       │   ├── ClientSelector.jsx          ← dropdown: GET /api/clients
│       │   ├── PeriodSelector.jsx          ← Q1/Q2/Q1-Q2/Full Year 2026
│       │   ├── QueryInput.jsx              ← free-text "What to check?"
│       │   ├── AnalyzeButton.jsx           ← submit → POST /api/analyze
│       │   ├── LoadingSpinner.jsx          ← loading state during API call
│       │   └── Report/
│       │       ├── ReportView.jsx          ← top-level report container
│       │       ├── ErrorSection.jsx        ← 🔴 Critical Errors list
│       │       ├── WarningSection.jsx      ← ⚠️ Warnings list
│       │       ├── OkSection.jsx           ← ✅ All Clear list
│       │       ├── SteuerreserveCard.jsx   ← 💰 tax reserve estimate
│       │       └── FindingCard.jsx         ← single finding (id, title, desc, recommendation)
│       └── variants/
│           └── WidgetVariant.jsx           ← UX Variant A: user-initiated widget
│
├── package.json                            ← root: scripts for dev/server/client
├── .env                                    ← ANTHROPIC_API_KEY (never commit)
└── .gitignore                              ← includes .env, node_modules
```

**Data structure per client JSON:**
```
client_XXX.json
├── client_id
├── display_name
├── company_settings      ← legal_form, vat_status, vat_report_period, gewst_required, ...
├── business_context      ← sales_channels, client_geography, reverse_charge_applicable, ...
├── transactions[]        ← id, date, amount, category, vat_rate, linked_invoice_id, ...
├── invoices[]            ← id, type, amount_gross, vat_rate, linked_transaction_id, file_path, ...
├── assets[]              ← id, name, category, amortization_period_years, is_vehicle, ...
├── bookkeeping_entries[] ← ⭐ NEW: id, type, amount, account_code, linked_transaction_id, ...
├── vat_reporting
│   └── reports[]         ← ⭐ NEW: UStVA/EÜR/ZM with status, due_date, amounts
└── tasks[]               ← ⭐ NEW: submit_report / fix_bookkeeping / review_finding tasks
```

---

## 2. Five Sequential Development Phases

### Phase 1 — Data Layer (`backend/tools.js`)
### Phase 2 — Agent Core (`backend/agent.js`)
### Phase 3 — API Server (`backend/server.js`)
### Phase 4 — Frontend (`frontend/`)
### Phase 5 — Integration Testing & Deployment

Each phase is independently testable. No phase begins before the previous one passes its test.

---

## 3. What Gets Built in Each Phase

---

### Phase 1 — Data Layer

**Goal:** Agent can read all client data from JSON files. No Claude API involved yet.

**Files created:**
- `backend/tools.js` — 5 exported async functions
- `backend/test_tools.js` — verification script

**Functions in `tools.js`:**

```javascript
get_transactions(period, company_id)
  // period: { start: "2026-01-01", end: "2026-03-31" }
  // Returns: { transactions: [...] } filtered by date range

get_invoices(period, company_id)
  // Returns: { invoices: [...] } filtered by invoice.date in range
  // Each invoice includes: file_path, file_available

get_company_settings(company_id)
  // Returns: { company_settings: {...}, business_context: {...}, vat_reporting: {...} }

get_assets(company_id)
  // Returns: { assets: [...] } — all assets (no date filter, full list)

get_client_knowledge_base(company_id)
  // Returns: { business_context: {...}, addresses: {...}, vehicles: [...], ... }
  // For Phase 0: reads from client_XXX.json (no separate KB file needed)

get_bookkeeping_entries(period, company_id)          // ⭐ NEW
  // Returns: { entries: [...] } filtered by entry.date in range
  // Includes: income, expense, depreciation, private_use, adjustment entries
  // Each entry has: account_code (SKR-04), linked_transaction_id, linked_invoice_id

get_reports(company_id, period?)                      // ⭐ NEW
  // Returns: { reports: [...] } — all reports, optionally filtered by period
  // Each report: type (UStVA/EÜR/ZM/GewSt), status, due_date, amounts

get_tasks(company_id)                                 // ⭐ NEW
  // Returns: { tasks: [...] } — all pending/in_progress/overdue tasks
  // Each task: type, status, due_date, linked_report_id, linked_finding_id

recognize_invoice_document(invoice_id)               // ⭐ NEW
  // Reads invoice_files/{client_id}/{invoice_id}.pdf via Claude Vision
  // Applies specialized extraction prompt → returns recognized fields
  // Fallback: reads {invoice_id}_recognized.json if file not available
```

**Period parsing logic:**
- Input formats supported: `"Q1 2026"`, `"Q2 2026"`, `"Q1-Q2 2026"`, `"Full Year 2026"`,
  or explicit `{ start, end }` ISO dates
- Converts to date range, then filters by `transaction.date` (or `invoice.date`)

**`test_tools.js` output:**
```
[PASS] get_transactions: 12 records returned for client_001 Q1 2026
[PASS] get_invoices: 8 records returned, 5 with file_path, 3 without
[PASS] get_company_settings: company_id=client_001, vat_status=Kleinunternehmer
[PASS] get_assets: 3 assets returned for client_001
[PASS] get_client_knowledge_base: business_context loaded, reverse_charge=true
[PASS] get_bookkeeping_entries: 18 entries returned (14 expense/income, 3 depreciation, 1 private)
[PASS] get_reports: 2 reports returned (UStVA Q1=submitted, EÜR 2025=draft)
[PASS] get_tasks: 2 tasks returned (1 overdue, 1 in_progress)
[PASS] recognize_invoice_document(inv_001_008): recognized amount=4760€, vat_rate=0.19
```

**Dependencies:**
- `backend/data/client_001.json` through `client_007.json` (already exist — need to add `bookkeeping_entries`, `tasks`, update `vat_reporting.reports[]`)
- `backend/data/invoice_files/client_001/` — PDF files to be generated before Phase 2

---

### Phase 2 — Agent Core

**Goal:** Claude API connected, tool_use loop working, first tax report generated.

**Files created:**
- `backend/agent.js` — Claude API integration + agentic loop
- `backend/test_agent.js` — end-to-end agent test (requires `.env` with API key)

**`agent.js` architecture:**

```
analyzeClient(clientId, period, userQuery, threadId?)
  │
  ├── Load system prompt (inline: CLAUDE.md rules + Tax_Checks_Catalog + Finanzamt Reference)
  ├── Retrieve or init conversation history (by threadId in in-memory Map)
  ├── Add user message to history
  │
  └── Claude API loop:
        1. POST to Anthropic API (model: claude-sonnet-4-6, tools: all 5)
        2. If response.stop_reason == "tool_use":
             a. For each tool_use block: call the matching function from tools.js
             b. Add tool results to message history
             c. Go to step 1
        3. If response.stop_reason == "end_turn":
             a. Extract JSON report from final text response
             b. Store updated history in Map under threadId
             c. Return { threadId, report }
```

**Tool definitions passed to Claude API:**
- `get_transactions` — description, parameters (period, company_id)
- `get_invoices` — description, parameters (period, company_id)
- `get_company_settings` — description, parameters (company_id)
- `get_assets` — description, parameters (company_id)
- `get_client_knowledge_base` — description, parameters (company_id)

**System prompt content (loaded inline at startup):**
1. Role definition (AI Tax Advisor for German Einzelunternehmer)
2. Full Tax_Checks_Catalog.md content (25 rules, Blocks A/B/C)
3. Full Finanzamt_Methodology_Reference.md content
4. Output format instruction (structured JSON + readable report)
5. Business context instruction (must load and apply before any checks)

**Expected output format:**
```json
{
  "errors": [
    { "id": "A-05", "title": "...", "description": "...", "affected_items": ["txn_001_008"], "recommendation": "..." }
  ],
  "warnings": [...],
  "ok_checks": [...],
  "steuerreserve": {
    "estimated_annual_tax": 0,
    "recommended_monthly_saving": 0,
    "notes": "..."
  }
}
```

**`test_agent.js` — expected result:**
```
Testing client_001, Q1 2026...
✅ Agent completed in 23s
✅ Found 2 errors, 3 warnings, 5 OK checks
✅ Expected error A-05 found: Kleinunternehmer issued invoice with 19% VAT (txn_001_008)
```

**Dependencies:** Phase 1 complete, `.env` with `ANTHROPIC_API_KEY`

---

### Phase 3 — API Server

**Goal:** Backend wrapped in HTTP API, callable from curl and frontend.

**Files created:**
- `backend/server.js` — Express + CORS, port 3001

**Endpoints:**

```
GET /api/clients
  Response: [
    { "id": "client_001", "display_name": "Anna Müller — IT-Freelancer" },
    ...
  ]
  Logic: read all client_XXX.json files from backend/data/, return id + display_name

POST /api/analyze
  Request body: {
    "clientId": "client_001",
    "period": "Q1 2026",
    "userQuery": "Check my books for errors",
    "threadId": null  (optional — omit for new conversation)
  }
  Response: {
    "threadId": "thread_abc123",
    "report": { errors[], warnings[], ok_checks[], steuerreserve }
  }
  Logic: call analyzeClient() from agent.js, return result

Error responses:
  400: missing clientId or period
  404: client data file not found
  503: ANTHROPIC_API_KEY not set
  500: agent error (with message)
```

**Dependencies:** Phase 2 complete

---

### Phase 4 — Frontend

**Goal:** React UI that drives the full user flow — select client, pick period, run analysis, view report.

**Files created:**
- `frontend/` — Vite + React project
- All components listed in the file structure above

**User flow:**
1. Open `http://localhost:3000`
2. Dropdown: select client (populated from `GET /api/clients`)
3. Period selector: Q1 2026 / Q2 2026 / Q1-Q2 2026 / Full Year 2026
4. Optional text input: "What do you want to check?"
5. Click "Check my books" → POST /api/analyze → loading spinner
6. Report renders in sections: 🔴 Errors → ⚠️ Warnings → ✅ OK → 💰 Steuerreserve
7. Follow-up: user types question → same threadId sent → agent responds in context

**Thread continuity:**
- `threadId` stored in React `useState`
- Set from first API response, sent with all subsequent requests
- Cleared when user switches client or period

**UI requirements:**
- Clean professional styling (not placeholder/toy-looking)
- Each finding card shows: severity badge, title, description, affected items, recommendation
- Steuerreserve card: monthly saving amount + explanation
- No auth, no login — MVP for internal testing

**Dependencies:** Phase 3 running on port 3001

---

### Phase 5 — Integration Testing & Deployment

**Goal:** All 7 clients produce correct reports; app is deployed and publicly accessible.

**Tasks:**
1. Run all 7 clients through the agent — verify expected errors are found per client
2. Measure false positive rate (< 20% target per PRD)
3. Verify response time < 60 seconds per PRD target
4. Configure Vercel deployment
5. Set `ANTHROPIC_API_KEY` in Vercel environment variables
6. Get public URL for user testing sessions

**⚠️ Test cases — placeholder (to be defined before Phase 5):**

Before running integration tests, a set of formal **test cases** must be created in `TEST_CASES.md`.
Each test case defines:
- **User query** — what the user asks (e.g. "Check my Q1 books", "Why is my VAT wrong?")
- **Client + period** — which mock client and date range to use
- **Expected findings** — which check IDs should fire (e.g. `A-05`, `B-ZM-01`) and which should not
- **Expected reasoning** — key logical steps the agent should take
- **Pass/fail criterion** — what makes the test pass

Test cases are not part of Phase 1–4. They are written in collaboration between
PM and developer once the agent produces first real outputs (end of Phase 2).
Until then, Phase 5 testing uses manual inspection of outputs.

**Dependencies:** Phases 1–4 complete

---

### Note on proactive checks in MVP

All checks — including those tagged `pre-UStVA`, `pre-EÜR`, `pre-ZM` — are triggered
**only by a user request from the frontend** (button click → `POST /api/analyze`).

The `trigger` field is informational metadata used by the agent to decide which checks
to include given the selected period. It does NOT schedule background jobs in Phase 0.

Automatic triggers (cron, data-change webhooks, pre-deadline reminders) are a
production concern — the agent code stays the same; only the caller changes.

---

## 4. How to Test Each Phase (Exact Commands)

### Phase 1 Test

```bash
# From project root (ai-tax-advisor.MVP/)
node backend/test_tools.js
```

Expected: 5 green [PASS] lines, one per tool, showing record counts.  
Fail condition: any [FAIL] or error means a JSON parsing or date-filter bug.

---

### Phase 2 Test

```bash
# Requires .env with ANTHROPIC_API_KEY
node backend/test_agent.js
```

Expected: agent completes, returns JSON with at least 1 error (A-05).  
Fail condition: API auth error → check .env; no errors found → check system prompt.

---

### Phase 3 Test

```bash
# Terminal 1: start server
node backend/server.js

# Terminal 2: test endpoints
curl http://localhost:3001/api/clients

curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"clientId":"client_001","period":"Q1 2026","userQuery":"Check my books"}'
```

Expected:
- `/api/clients` → JSON array with 7 clients
- `/api/analyze` → JSON with `threadId` and `report` object

---

### Phase 4 Test

```bash
# Terminal 1: backend (already running or restart)
node backend/server.js

# Terminal 2: frontend dev server
cd frontend && npm run dev
```

Then open `http://localhost:5173` (Vite default) or `http://localhost:3000` in browser.  
Test: select each of the 7 clients, run analysis, verify report renders with correct sections.

---

### Phase 5 Test

```bash
# Run all clients sequentially
node backend/test_agent.js --all

# Deploy to Vercel
vercel --prod
```

Then open the Vercel URL and verify the full flow works in production.

---

## 5. Phase Dependencies

```
Phase 1 ─────────────────────────────────────────────────► Phase 2
(tools.js)        must pass before         (agent.js — calls tools)
                                                    │
                                                    ▼
                                                Phase 3
                                           (server.js — wraps agent)
                                                    │
                                                    ▼
                                                Phase 4
                                         (frontend — calls server)
                                                    │
                                                    ▼
                                                Phase 5
                                     (integration test + deploy)
```

**External dependencies:**
- `backend/data/client_001–007.json` — already exist (Phase 0 complete)
- `ANTHROPIC_API_KEY` — needed from Phase 2 onward (get from console.anthropic.com)
- Node.js — must be installed before any `npm install`

**npm packages to install (root `package.json`):**
- Backend: `express`, `cors`, `dotenv`, `@anthropic-ai/sdk`
- Frontend (in `frontend/package.json`): `react`, `react-dom`, `vite`, `@vitejs/plugin-react`

**Startup commands (from root):**
```bash
npm install          # install backend deps
npm run server       # start backend on port 3001
npm run client       # start frontend on port 5173 (or 3000)
npm run dev          # start both concurrently
```
