# AI Tax Advisor MVP — Architecture

**Версия:** 0.1  
**Дата:** Май 2026  
**Статус:** Утверждается перед началом разработки

---

## 1. Полный request flow

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER  (port 5173)                                           │
│                                                                 │
│  1. User selects client, period, enters query                   │
│  2. Clicks "Check my books"                                     │
│  3. Shows loading spinner                                       │
│  4. Renders report when response arrives                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /api/analyze
                           │ { clientId, period, userQuery, threadId? }
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  EXPRESS SERVER  backend/server.js  (port 3001)                 │
│                                                                 │
│  - Validates request body                                       │
│  - Calls analyzeClient(clientId, period, userQuery, threadId)   │
│  - Returns { threadId, report } or error                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ analyzeClient()
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  AGENT  backend/agent.js                                        │
│                                                                 │
│  - Loads system prompt from KB files                            │
│  - Retrieves or creates conversation history (by threadId)      │
│  - Runs tool_use loop (see Section 2)                           │
│  - Parses final JSON report from Claude's response              │
│  - Saves updated history to Map                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ tool calls
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  TOOLS  backend/tools.js                                        │
│                                                                 │
│  get_transactions        get_invoices      get_company_settings │
│  get_assets              get_client_kb     get_bookkeeping_entries│
│  get_reports             get_tasks         recognize_invoice_doc │
└──────┬──────────┬──────────────────────────────────┬────────────┘
       │          │                                  │
       ▼          ▼                                  ▼
┌────────────┐ ┌─────────────────────────────┐ ┌──────────────────┐
│ client_    │ │ invoice_files/              │ │ Anthropic API    │
│ XXX.json   │ │ client_XXX/inv_XXX.pdf      │ │ (Vision, for     │
│            │ │ client_XXX/inv_XXX_         │ │ recognize_       │
│ transactions│ │ recognized.json (fallback)  │ │ invoice_doc only)│
│ invoices   │ └─────────────────────────────┘ └──────────────────┘
│ assets     │
│ entries    │
│ reports    │
│ tasks      │
└────────────┘
```

**Ответ проходит тот же путь обратно:**
```
tools.js → agent.js (tool results) → Anthropic API → agent.js (final response)
→ server.js { threadId, report } → frontend → рендер отчёта
```

---

## 2. Tool_use loop — пошаговая схема

```
agent.js получает вызов analyzeClient(clientId, period, userQuery, threadId)
│
├─ [1] Подготовка
│      loadSystemPrompt()  ← читает Tax_Checks_Catalog.md + Finanzamt_Methodology_Reference.md
│      history = conversationHistory.get(threadId) || []
│      history.push({ role: "user", content: userQuery })
│
├─ [2] Первый вызов Claude API
│      POST https://api.anthropic.com/v1/messages
│      {
│        model: "claude-sonnet-4-6",
│        system: <system prompt>,
│        messages: history,
│        tools: [/* 9 tool definitions */],
│        max_tokens: 8096
│      }
│
├─ [3] Claude отвечает → stop_reason: "tool_use"
│      response.content = [
│        { type: "text",     text: "Начинаю анализ..." },
│        { type: "tool_use", id: "tu_abc", name: "get_company_settings",
│          input: { company_id: "client_001" } },
│        { type: "tool_use", id: "tu_def", name: "get_transactions",
│          input: { period: "Q1 2026", company_id: "client_001" } },
│        ...
│      ]
│
├─ [4] Параллельное выполнение всех tool_use блоков
│      results = await Promise.all(
│        toolUseCalls.map(call => executeTool(call.name, call.input))
│      )
│
├─ [5] Добавить assistant-ответ и tool results в историю
│      history.push({ role: "assistant", content: response.content })
│      history.push({
│        role: "user",
│        content: [
│          { type: "tool_result", tool_use_id: "tu_abc", content: JSON.stringify(result1) },
│          { type: "tool_result", tool_use_id: "tu_def", content: JSON.stringify(result2) },
│          ...
│        ]
│      })
│
├─ [6] Повторить с шага [2] — Claude может запросить ещё инструменты
│
└─ [7] Claude отвечает → stop_reason: "end_turn"
       response.content = [
         { type: "text", text: "```json\n{ errors: [...], warnings: [...] }\n```\n\nОтчёт: ..." }
       ]
       │
       ├─ Извлечь JSON из текста (regex: ```json ... ```)
       ├─ history.push({ role: "assistant", content: response.content })
       ├─ conversationHistory.set(threadId, history)
       └─ return { threadId, report: parsedJSON }
```

**Максимальное количество итераций:** 10 (защита от бесконечного цикла).  
**Если лимит достигнут:** вернуть ошибку `{ error: "agent_loop_limit_exceeded" }`.

---

## 3. Thread ID — хранение и извлечение истории

```javascript
// agent.js — module-level (живёт пока запущен сервер)
const conversationHistory = new Map();
// Map<threadId: string, messages: Message[]>

function analyzeClient(clientId, period, userQuery, threadId) {

  // Новый разговор — создаём threadId
  if (!threadId) {
    threadId = crypto.randomUUID();       // "a3f2b1c4-7e8d-..."
    conversationHistory.set(threadId, []);
  }

  // Существующий разговор — загружаем историю
  const history = conversationHistory.get(threadId) ?? [];

  // ... tool_use loop ...

  // Сохраняем обновлённую историю
  conversationHistory.set(threadId, history);

  return { threadId, report };
}
```

**Жизненный цикл threadId:**
- Создаётся на первом запросе → возвращается фронтенду в ответе
- Фронтенд хранит в `useState` и отправляет при каждом следующем запросе
- История хранится **в памяти сервера** — сбрасывается при перезапуске
- Смена клиента или периода на фронтенде → фронтенд обнуляет threadId → новый разговор

**Ограничение Phase 0:** персистентность не нужна (сессии до 60 минут).  
**В продакшене:** заменить Map на Redis или PostgreSQL.

---

## 4. Переменные окружения (.env)

```bash
# backend/.env  (или корневой .env)

# Обязательно — без этого агент не запустится
ANTHROPIC_API_KEY=sk-ant-api03-...

# Опционально — порт бэкенда (default: 3001)
PORT=3001
```

**Правила:**
- `.env` добавлен в `.gitignore` — никогда не коммитить
- При деплое на Vercel: задать `ANTHROPIC_API_KEY` в Environment Variables
- Читается в `server.js` через `require('dotenv').config()`
- Проверять при старте: если ключ не задан → `process.exit(1)` с понятным сообщением

---

## 5. Схема POST /api/analyze

### Запрос

```
POST http://localhost:3001/api/analyze
Content-Type: application/json
```

```json
{
  "clientId": "client_001",
  "period":   "Q1 2026",
  "userQuery": "Check my Q1 books for errors",
  "threadId": null
}
```

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `clientId` | string | ✅ | ID клиента: `"client_001"` … `"client_007"` |
| `period` | string | ✅ | `"Q1 2026"`, `"Q2 2026"`, `"Q1-Q2 2026"`, `"Full Year 2026"` |
| `userQuery` | string | ✅ | Вопрос или команда пользователя (не пустая строка) |
| `threadId` | string\|null | ❌ | Передать для продолжения разговора; `null` = новый |

**Разбор `period` в agent.js:**
```
"Q1 2026"      → { start: "2026-01-01", end: "2026-03-31" }
"Q2 2026"      → { start: "2026-04-01", end: "2026-06-30" }
"Q1-Q2 2026"   → { start: "2026-01-01", end: "2026-06-30" }
"Full Year 2026" → { start: "2026-01-01", end: "2026-12-31" }
```

---

### Ответ — успех (200)

```json
{
  "threadId": "a3f2b1c4-7e8d-4b2a-9c1f-d5e6f7a8b9c0",
  "report": {
    "errors": [
      {
        "id":             "A-05",
        "title":          "Kleinunternehmer выставляет инвойс с НДС",
        "description":    "Инвойс №inv_001_008 от 14.03.2026 содержит НДС 19%...",
        "affected_items": ["inv_001_008", "txn_001_008"],
        "recommendation": "Удалите НДС из инвойса и добавьте фразу §19 UStG..."
      }
    ],
    "warnings": [
      {
        "id":             "B-06",
        "title":          "Телефон/интернет без private use split",
        "description":    "3 транзакции на сумму 267 € без разделения на бизнес/личное...",
        "affected_items": ["txn_001_002", "txn_001_009", "txn_001_014"],
        "recommendation": "Используйте функцию Split в Finom: 50% бизнес / 50% личное."
      }
    ],
    "ok_checks": [
      {
        "id":    "C-01",
        "title": "Kleinunternehmer — нет вычета Vorsteuer",
        "description": "Вычеты Vorsteuer в проводках отсутствуют. Всё верно."
      }
    ],
    "steuerreserve": {
      "estimated_annual_income":   48000,
      "estimated_annual_tax":       9840,
      "already_reserved":              0,
      "recommended_monthly_saving":  820,
      "kleinunternehmer_threshold_warning": false,
      "notes": "Расчёт предварительный, без учёта вычетов."
    }
  }
}
```

---

### Ответы — ошибки

```json
400  { "error": "missing_fields",    "message": "clientId and period are required" }
404  { "error": "client_not_found",  "message": "No data file for client_003" }
503  { "error": "no_api_key",        "message": "ANTHROPIC_API_KEY is not set" }
504  { "error": "agent_timeout",     "message": "Agent did not respond within 90s" }
500  { "error": "agent_error",       "message": "<original error message>" }
```

---

## 6. GET /api/clients

```
GET http://localhost:3001/api/clients
```

**Ответ (200):**
```json
[
  { "id": "client_001", "display_name": "Anna Müller — IT-Freelancer" },
  { "id": "client_002", "display_name": "..." },
  ...
]
```

**Логика:** сканировать `backend/data/client_*.json`, читать `client_id` и `display_name`.

---

## 7. Системный промпт агента — структура загрузки

```javascript
// agent.js — при старте или первом вызове
function loadSystemPrompt() {
  const catalog   = fs.readFileSync('Tax_Checks_Catalog.md',  'utf8');
  const finanzamt = fs.readFileSync('knowledge_base/Finanzamt_Methodology_Reference.md', 'utf8');

  return `
You are an AI Tax Advisor in Finom, a German accounting app for Einzelunternehmer.
[... role definition from Claude.md ...]

## TAX CHECKS CATALOG
${catalog}

## FINANZAMT METHODOLOGY REFERENCE
${finanzamt}

## OUTPUT FORMAT
Return a JSON code block followed by a readable summary.
JSON structure: { errors[], warnings[], ok_checks[], steuerreserve }
Each item: { id, title, description, affected_items[], recommendation }
  `;
}
```

**Примечание:** промпт загружается один раз при старте сервера и кешируется в переменной.  
Остальные KB-файлы (`Tax_Thresholds_Current.md` и др.) добавляются по мере создания.

---

## 8. Параллельность tool calls

Claude может запросить несколько инструментов в одном ответе. Все они выполняются параллельно:

```javascript
// agent.js
const toolCalls = response.content.filter(b => b.type === 'tool_use');

const results = await Promise.all(
  toolCalls.map(call => executeTool(call.name, call.input))
);
```

**Исключение:** `recognize_invoice_document` делает собственный вызов Claude Vision API —
он выполняется параллельно с другими инструментами, но внутри сам является асинхронным.

---

## 9. CORS — настройка

```javascript
// server.js
const cors = require('cors');
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST']
}));
```

При деплое на Vercel origin добавляется через env-переменную `FRONTEND_URL`.
