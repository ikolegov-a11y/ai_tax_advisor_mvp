# AI Tax Advisor — Phase 0 (MVP Concept Validation)

## What we're building

A standalone web application to validate the AI Tax Advisor concept with 10 real Finom beta clients.
This is NOT integrated into the production Finom app — it's an independent prototype.

**Goal:** Test whether the AI Tax Advisor finds real errors in real client accounting data,
and whether users trust and act on the findings.

## Key documentation files (read these first)

- `PRD_AI_Tax_Advisor.md` — Product requirements, Phase 0 hypotheses (H1–H8), UX variants
- `Technical_Spec.md` — Architecture, data schemas, agent tools, system prompt
- `Tax_Checks_Catalog.md` — 31 tax rules the agent must check (Blocks A, B-Core, B-EÜR, B-UStVA, B-ZM, C, E)

## Tech stack

- **Backend:** Node.js + Express
- **Frontend:** React (Vite)
- **AI:** Anthropic API (Claude) with tool use
- **Mock data:** JSON files (one per beta client)
- **Deployment:** Vercel

## Project structure to create

```
ai-tax-advisor.MVP/
├── CLAUDE.md                 ← this file
├── PRD_AI_Tax_Advisor.md
├── Technical_Spec.md
├── Tax_Checks_Catalog.md
│
├── backend/
│   ├── server.js             ← Express server
│   ├── agent.js              ← Claude API + tool use logic
│   ├── tools.js              ← Mock data tools (get_transactions, get_invoices, etc.)
│   └── data/
│       ├── client_001.json   ← Mock data: client 1 (transactions + invoices + settings + assets)
│       ├── client_002.json
│       └── ... (up to client_010.json)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── variants/
│   │   │   ├── WidgetVariant.jsx    ← UX Variant A: checklist widget
│   │   │   └── ChatVariant.jsx      ← UX Variant B: proactive chat
│   │   └── components/
│   └── index.html
│
└── package.json
```

## Two UX variants to test

**Variant A — Widget/Checklist** (`?variant=widget`)
User sees a health indicator on the main page and initiates a check manually ("Check my books").
Output: structured checklist report (ERRORs → WARNINGs → OK checks).

**Variant B — Proactive Chat** (`?variant=chat`)
AI assistant proactively initiates: "I checked your Q1 books. Found 3 issues. Start with the most critical?"
Output: conversational dialog format.

Switch between variants via URL query parameter: `http://localhost:3000?variant=widget` or `?variant=chat`

## Mock data format (per client JSON file)

Each client file contains:
```json
{
  "client_id": "client_001",
  "company_settings": { ... },   // See Technical_Spec.md section 3.3
  "transactions": [ ... ],        // See Technical_Spec.md section 3.1
  "invoices": [ ... ],            // See Technical_Spec.md section 3.2
  "assets": [ ... ]               // See Technical_Spec.md section 4.1
}
```

Full field schemas are in `Technical_Spec.md` sections 3 and 4.

## Agent tools (mock implementations)

These tools read from the client's JSON file — no real database needed:

- `get_transactions(period, company_id)` → returns transactions array
- `get_invoices(period, company_id)` → returns invoices array
- `get_company_settings(company_id)` → returns company settings object + business_context + vat_reporting
- `get_assets(company_id)` → returns assets array
- `get_client_knowledge_base(company_id)` → returns client KB with personal profile + **business_context**
- `get_bookkeeping_entries(period, company_id)` → returns accounting entries (Buchungssätze); used for proactive checks and report-level analysis; entries include depreciation (no cash movement) and split items
- `get_reports(company_id, period?)` → returns tax reports (UStVA, EÜR, ZM) with statuses: draft / submitted / accepted / overdue
- `get_tasks(company_id)` → returns user tasks with deadlines and statuses (pending / in_progress / completed / overdue)
- `recognize_invoice_document(invoice_id)` → reads the invoice PDF/image file, applies specialized OCR prompt via Claude Vision, returns structured recognized fields for comparison with stored data

## Business context (CRITICAL for correct analysis)

Each client JSON file includes a `business_context` block. The agent MUST load and apply this context before running any checks. The same transaction can be correct or an error depending on the business model:

- `sales_channels`: ["own_website", "amazon_fba", "upwork", "etsy", "fiverr", ...]
- `client_geography`: ["de", "eu", "international"]
- `has_eu_b2b_clients`: affects ZM report requirement and Reverse Charge
- `has_international_clients`: affects VAT rules on outgoing invoices
- `uses_marketplace`: marketplace commissions are a normal expense category
- `has_ksk_membership`: affects social contributions analysis
- `reverse_charge_applicable`: 0% VAT on outgoing invoices is CORRECT, not an error
- `oss_vat_registered`: affects EU B2C sales VAT obligations
- `notes`: free text with business specifics

If business_context is missing or empty, the agent must explicitly warn:
"For more accurate analysis, please fill in your Business Profile in Settings."

## Tax checks to implement

See `Tax_Checks_Catalog.md` for all 31 rules across 6 blocks:
- **Block A:** Invoice ↔ stored data + document recognition (5 rules)
- **Block B-Core:** Accounting contradictions — always applicable (4 rules)
- **Block B-EÜR:** Issues affecting annual EÜR report (3 rules)
- **Block B-UStVA:** Issues affecting VAT return UStVA (5 rules)
- **Block B-ZM:** Issues affecting EU B2B summary report ZM (2 rules)
- **Block C:** Settings/status contradictions (4 rules)
- **Block E:** Logical consistency checks — second pass (8 rules)

Each check has a **trigger**: `always`, `pre-UStVA`, `pre-EÜR`, or `pre-ZM`.
The agent uses `get_bookkeeping_entries` to run checks proactively.

## Two-pass analysis approach

The agent runs analysis in two passes:

**Pass 1 — Formal checks (Blocks A, B, C):** Check individual records against rules.
Each rule is deterministic: fact X conflicts with rule Y → flag it.

**Pass 2 — Logical consistency (Block E):** After formal checks, step back and look at patterns.
Ask: "Does the overall picture make sense?" Key questions:
- Are private use split ratios consistent across related categories?
- Do any ratios hit implausible extremes (0% or 100% private use)?
- Do expense proportions fall within industry norms (Richtsätze BMF)?
- Are there suspiciously many round-number entries (Schätzung risk)?
- Are expected paired records present (car expenses → asset or Kilometerpauschale)?
- Is there an unusual year-end expense spike?

Pass 2 findings are labelled separately in the output so users understand
the difference between "this is wrong" (Pass 1) and "this looks unusual" (Pass 2).

## Invoice file storage

Invoice PDF/image files are stored in `backend/data/invoice_files/{client_id}/{invoice_id}.pdf`.
Each invoice record in the JSON includes a `file_path` field and `file_available` boolean.
The `recognize_invoice_document` tool reads these files and applies a specialized extraction prompt.
If `file_available == false`, skip check A-09 for that invoice — do NOT generate a false positive.

## Knowledge base files

Agent knowledge base is split into focused files in `knowledge_base/`:
- `Finanzamt_Methodology_Reference.md` — audit methods, RMS, Richtsätze (EXISTS)
- `Tax_Thresholds_Current.md` — thresholds: KU limit, GWG, Pauschalen (TO CREATE)
- `SKR04_Account_Plan.md` — SKR-04 chart of accounts (TO CREATE)
- `VAT_Rules_Reference.md` — §14/§19 UStG, Reverse Charge, ZM rules (TO CREATE)
- `Depreciation_AfA_Reference.md` — AfA tables, 1%-rule, GWG (TO CREATE)
- `Deduction_Rules_Reference.md` — §4 Abs. 5 EStG, Bewirtung, Home Office (TO CREATE)
- `Report_Forms_Reference.md` — UStVA, EÜR, ZM form structures (TO CREATE)

For Phase 0: all available KB files are loaded into system prompt at startup.

## Original Tax checks to implement (legacy — replaced above)
- **Block B:** Accounting contradictions (9 rules)
- **Block C:** Reporting contradictions (8 rules)

Plus **Steuerreserve:** estimate annual tax liability and recommend monthly savings amount.

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

## Development notes

- Keep mock data realistic — use messy real-world data, not clean synthetic data
- The two UX variants share the same backend/agent — only the frontend differs
- Anthropic API key: set in `.env` file as `ANTHROPIC_API_KEY=sk-ant-...`
- DO NOT commit `.env` to git
- Target model: claude-sonnet-4-6 (not Haiku — need reasoning quality for tax analysis)

## Key commands

```bash
# Install dependencies
npm install

# Start backend (port 3001)
npm run server

# Start frontend (port 3000)
npm run client

# Start both
npm run dev
```