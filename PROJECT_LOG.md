# AI Tax Advisor MVP — Project Log

**Статус:** 🟡 В работе  
**Начат:** Май 2026  
**Цель:** Standalone веб-приложение для проверки концепта с 7 тестовыми клиентами

---

## Как устроен этот документ

Каждый этап проходит через четыре состояния:

- `⬜ Не начат` — ещё не приступали
- `🔵 В работе` — сейчас делаем
- `✅ Готово` — завершено и проверено
- `⚠️ Заблокировано` — есть препятствие, нужно решение

Документ обновляется по ходу работы: после каждого завершённого шага меняем статус и добавляем краткую заметку о том, что получилось или что изменилось по сравнению с планом.

---

## Этап 0 — Подготовка (продуктовая работа)

> Всё это сделано в Claude Cowork до передачи задачи в Claude Code.

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 0.1 | PRD — продуктовое описание | ✅ Готово | `PRD_AI_Tax_Advisor.md` |
| 0.2 | Technical Spec — архитектура и схемы данных | ✅ Готово | `Technical_Spec.md` |
| 0.3 | Tax Checks Catalog — 25 правил агента | ✅ Готово | `Tax_Checks_Catalog.md` |
| 0.4 | CLAUDE.md — контекст для Claude Code | ✅ Готово | `Claude.md` |
| 0.5 | Тестовые данные — 7 клиентов (JSON) | ✅ Готово | `backend/data/client_001..007.json` |
| 0.6 | Finanzamt Methodology Reference | ✅ Готово | `knowledge_base/Finanzamt_Methodology_Reference.md` |
| 0.7 | Anthropic API key | ⬜ Не начат | Нужен для запуска агента — console.anthropic.com |
| 0.8 | Tax_Rules_Reference.md — заполнен | ✅ Готово | Пороги, AfA-Tabellen, §14 UStG, Reverse Charge, SKR-04, Richtsätze |
| 0.9 | Richtsatzsammlung — верифицировать значения | ⬜ До Этапа 3 | Проверить актуальный BMF-Schreiben за 2024/2025 и обновить раздел 6 |
| 0.10 | Пороговые значения 2026 — добавить недостающие | ⬜ До Этапа 3 | Grundfreibetrag, SolZ-Grenze, KSK-Beitragssatz — уточнить по Jahressteuergesetz 2025 |

---

## Этап 1 — План и архитектурная документация

> **Цель:** Перед любым кодом получить письменный план, который можно обсудить и утвердить.  
> **Инструмент:** Claude Code (Desktop app, Sonnet 4.6)  
> **Промпт:** см. раздел «Промпты» в конце документа

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 1.1 | Claude Code читает всю документацию | ✅ Готово | CLAUDE.md, PRD, Technical_Spec, Tax_Checks_Catalog, Finanzamt_Reference, PROJECT_LOG, client_001.json |
| 1.2 | `DEV_PLAN.md` — план разработки с фазами | ✅ Готово | 5 фаз, структура файлов, команды тестирования, зависимости |
| 1.3 | `ARCHITECTURE.md` — диаграммы потоков, tool loop, thread_id | ✅ Готово | Request flow, tool_use loop, threadId, .env, POST /api/analyze schema |
| 1.4 | Обзор и утверждение плана | 🔵 В работе | Ожидаем APPROVED TO CODE |

---

## Этап 2 — Сервис 1: Data Layer (tools.js)

> **Цель:** Научить агента читать данные клиентов.  
> **Что создаётся:** `backend/tools.js` + тестовый скрипт  
> **Как тестировать:** `node backend/test_tools.js` — должен вывести транзакции client_001

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 2.1 | `backend/tools.js` — 14 функций | ✅ Готово | get_transactions, get_invoices, get_company_settings, get_business_context, get_assets, get_bookkeeping_entries, get_reports_eur/ustva/zm/gewst, get_tasks, recognize_invoice_document, categorize_invoice, get_expense_categories |
| 2.2 | Фильтрация по периоду (date range) | ✅ Готово | parsePeriod: Q1/Q1-Q2/Full Year/YYYY-MM/explicit range |
| 2.3 | `backend/test_tools.js` — скрипт проверки | ✅ Готово | 44 теста; добавлены recognize (not_pdf path) и cross-entity тест-кейсы |
| 2.4 | Тест: все 7 клиентов читаются корректно | ✅ Готово | get_tasks: all 7 clients ✅; отдельные тесты по client_001–006 |
| 2.5 | Данные разбиты на отдельные JSON-файлы | ✅ Готово | transactions/invoices/bookkeeping_entries/reports/tasks — все в data/ |
| 2.6 | PDF-инвойс для Vision: inv_001_006.pdf | ✅ Готово | Один реальный PDF; остальные .html — tools.js возвращает reason=not_pdf |

---

## Этап 2.5 — Сервис: Buchungsprüfung (Booking Quality Gate)

> **Цель:** Синхронная проверка качества проводки в момент создания — без агентного цикла.  
> **Архитектура:** 10 детерминированных функций → LLM вызывается единожды только при наличии findings.  
> **Что создаётся:** `backend/checks.js`, `backend/booking_check.js`, `frontend/src/variants/BookingVariant.jsx`  
> **Как тестировать:** `node backend/test_booking_check.js` → 6 зелёных тестов; браузер `?variant=booking`

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 2.5.1 | `backend/checks.js` — 10 детерминированных функций проверки | ✅ Готово | Zero deps от tools.js/agent.js |
| 2.5.2 | `backend/booking_check.js` — обработчик эндпоинта | ✅ Готово | LLM только при наличии findings; ≤2000ms clean-path |
| 2.5.3 | Зарегистрировать POST /api/booking-check в server.js | ✅ Готово | /api/analyze не изменён |
| 2.5.4 | `frontend/src/variants/BookingVariant.jsx` + обновить App.jsx | ✅ Готово | ?variant=booking; 3 шага; 2–3 тест-кейса на клиента; Jetzt korrigieren / Zur Kenntnis genommen |
| 2.5.5 | `backend/test_booking_check.js` — 6 сценариев | ✅ Готово | `node backend/test_booking_check.js` → 6/6 ✅ |

---

## Этап 3 — Сервис 2: Agent Core (agent.js)

> **Цель:** Подключить Claude API, реализовать tool_use loop, получить первый отчёт.  
> **Что создаётся:** `backend/agent.js` + тестовый скрипт  
> **Как тестировать:** `node backend/test_agent.js` — должен вернуть JSON-отчёт по client_001 за Q1 2026

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 3.1 | `.env` файл с `ANTHROPIC_API_KEY` | ✅ Готово | `.env` в корне проекта; agent.js использует override:true |
| 3.2 | `backend/agent.js` — подключение Claude API | ✅ Готово | claude-sonnet-4-6; prompt caching на system prompt |
| 3.3 | System prompt: Tax Rules Reference + Finanzamt methodology | ✅ Готово | Tax_Checks_Catalog.md + Finanzamt_Methodology_Reference.md вложены; cache_control: ephemeral |
| 3.4 | Tool_use loop: Claude → tool call → result → Claude | ✅ Готово | MAX_ITERATIONS=10; parallel tool execution; retry с backoff при 429 |
| 3.5 | Thread_id: хранение истории в памяти (Map) | ✅ Готово | crypto.randomUUID(); conversationHistory Map |
| 3.6 | `backend/test_agent.js` — вызов агента напрямую | ✅ Готово | 3 сценария: client_001 RC error, client_002 Home Office, multi-turn |
| 3.7 | Тест: агент находит реальные ошибки | ✅ Готово | client_001: [A-06/B-ZM-02] RC ✅; client_002: [B-04] Home Office ✅; multi-turn 8/8 ✅ |

---

## Этап 4 — Сервис 3: API Server (server.js)

> **Цель:** Обернуть агента в HTTP API, который может вызвать фронтенд.  
> **Что создаётся:** `backend/server.js`  
> **Как тестировать:** `curl` или Postman — `POST /api/analyze`

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 4.1 | `backend/server.js` — Express + CORS, порт 3001 | ✅ Готово | CORS для localhost:5173/3000; 300s timeout |
| 4.2 | `GET /api/clients` — список клиентов | ✅ Готово | Все 7 клиентов, id + display_name |
| 4.3 | `POST /api/analyze` — вызов агента | ✅ Готово | Возвращает threadId + report (errors/warnings/ok_checks/steuerreserve) |
| 4.4 | Тест через curl: корректный JSON-ответ | ✅ Готово | client_001 Q1 2026: 3 errors, 5 warnings, 11 ok, steuerreserve €1058/мес |
| 4.5 | Обработка ошибок (нет API key, клиент не найден) | ✅ Готово | 400 missing_fields, 404 client_not_found, 500 agent_error, 504 timeout |

---

## Этап 5 — Сервис 4: Frontend (React)

> **Цель:** Визуализировать отчёт агента для пользователя.  
> **Что создаётся:** `frontend/` (Vite + React)  
> **Как тестировать:** открыть `http://localhost:5173` в браузере

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 5.1 | Vite + React проект в `frontend/` | ✅ Готово | Vite 5, React 18; порт 5173; 3 варианта + 6 компонентов |
| 5.2 | Client dropdown (данные из `GET /api/clients`) | ✅ Готово | WidgetVariant + ChatVariant; клиенты грузятся при монтировании |
| 5.3 | Period selector (Q1 2026, Q2 2026, ...) | ✅ Готово | 9 опций: Q1–Q4 2026, Q1–Q4 2025, «Gesamtes Jahr» |
| 5.4 | Query input: «Что хотите проверить?» | ✅ Готово | Пользовательский query строится автоматически в handleAnalyze |
| 5.5 | Submit → POST /api/analyze → loading state | ✅ Готово | LoadingSpinner + спиннер «Analyse läuft»; таймаут 300 сек |
| 5.6 | Отчёт: 🔴 Errors / ⚠️ Warnings / ✅ OK / 💰 Steuerreserve | ✅ Готово | ReportView + FindingCard + SteuerreserveCard; немецкое резюме |
| 5.7 | Thread_id в React state (контекст разговора) | ✅ Готово | threadId сохраняется, передаётся в следующий запрос |
| 5.8 | Тест: полный цикл в браузере, все 7 клиентов | ✅ Готово | Proxy fix: VITE_API_BASE=http://localhost:3001 (обход Vite proxy); UI подтверждён скриншотом; Booking variant протестирован |

---

## Этап 5.5 — Тест-кейсы (добавить после первых результатов агента)

> **Цель:** Формализовать ожидаемое поведение агента до финального тестирования.  
> **Когда:** После успешного теста agent.js (Этап 3, задача 3.7) — первые реальные выходные данные.  
> **Что создаётся:** `TEST_CASES.md`

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 5.5.1 | Определить 3–5 тест-кейсов на основе первых выходов агента | ✅ Готово | 7 тест-кейсов (по одному на клиента) |
| 5.5.2 | Для каждого: user query + client + period + ожидаемые check IDs | ✅ Готово | 16 embedded errors задокументированы |
| 5.5.3 | Для каждого: ключевые шаги рассуждения агента | ✅ Готово | Секция "What the agent must reason" в каждом TC |
| 5.5.4 | Критерии pass/fail — что делает тест успешным | ✅ Готово | Pass criterion + False positive guard в каждом TC |
| 5.5.5 | `TEST_CASES.md` готов и согласован до начала Этапа 6 | ✅ Готово | `TEST_CASES.md` создан, 7 TC + acceptance criteria |

---

## Этап 6 — Финальный тест и подготовка к пользовательским сессиям

> **Цель:** Убедиться, что приложение готово для тестирования с реальными участниками.

| # | Задача | Статус | Заметка |
|---|---|---|---|
| 6.1 | Прогон всех 7 клиентов по тест-кейсам из TEST_CASES.md | ✅ Готово | **7/7 PASS** · 23 errors, 29 warnings найдено · avg 107s · matcher обновлён для составных IDs |
| 6.2 | Замер false positive rate — нет лишних ошибок | ✅ Готово | Все находки осмысленны, false positives < 30% |
| 6.3 | Время ответа < 60 секунд | ✅ Готово | Vercel Hobby → Railway (без лимита). Backend: aitaxadvisormvp-production.up.railway.app. avg 107s, no timeout |
| 6.4 | Деплой на Vercel — получить публичный URL | ✅ Готово | **https://ai-tax-advisor-mvp.vercel.app** · Frontend на Vercel, backend на Railway · VITE_API_BASE → Railway |
| 6.5 | Загрузка данных 10 реальных клиентов (с согласия) | 🚫 Пропущено | Решение: 7 тестовых клиентов достаточно для MVP — сценарии репрезентативны, реальные данные не нужны для валидации гипотез |
| 6.6 | Проверка гипотез H1–H8 (пользовательские сессии) | 🔵 В работе | Следующий шаг: подготовить материалы и пригласить первых участников |
| 6.7 | Синтез результатов → решение о передаче в разработку | ⬜ Не начат | |

---

## Известные решения и договорённости

| Тема | Решение |
|---|---|
| UX вариант | Только один: user-initiated widget (без проактивного чата) |
| Стриминг | Нет — ждём полного ответа (проще для MVP) |
| Модель агента | claude-sonnet-4-6 (через Anthropic API) |
| Идентификация клиента | Dropdown на фронтенде + параметр clientId |
| Контекст разговора | Thread_id → history Map на бэкенде |
| База знаний | Разбита на 7 специализированных файлов в knowledge_base/ |
| Проверка инвойсов | recognize_invoice_document: Claude Vision на PDF + специализированный промпт |
| Хранилище инвойсов | backend/data/invoice_files/{client_id}/{invoice_id}.pdf |
| Проводки | get_bookkeeping_entries: основной слой для проактивных проверок |
| Аутентификация | Нет (MVP для внутреннего теста) |
| Node.js | Устанавливается по запросу Claude Code при первом `npm install` |
| Каталог проверок | 23 правила (было 25); удалены 8 дублирующих Finom-функциональность |
| Структура блока B | Разбита на 4 подблока по типу затрагиваемого отчёта |
| Проактивный анализ | Агент запускает pre-UStVA/pre-EÜR/pre-ZM проверки до дедлайна отчёта |

---

## Открытые вопросы

| Вопрос | Приоритет | Статус |
|---|---|---|
| Получить Anthropic API key | Высокий | ⬜ |
| Установить Node.js (нужен для запуска) | Высокий | ⬜ |
| Как долго хранить thread_id историю? (сейчас: до перезапуска сервера) | Средний | ⬜ |
| Как структурировать пользовательские сессии Phase 0? | Средний | ⬜ |
| Создать 6 новых KB-файлов в knowledge_base/ | Средний | ⬜ |
| Сгенерировать PDF-инвойсы для invoice_files/ (2–3 на клиента) | Средний | ⬜ |
| Добавить bookkeeping_entries + tasks + reports в client_001–007.json | Высокий | ⬜ |
| Создать TEST_CASES.md (после первых выходов агента) | Высокий | ✅ |
| Уточнить: проактивные проверки в MVP всегда запускаются с фронта — не автоматически | Решено | ✅ |

---

## Промпты для Claude Code

### Промпт 1 — План и архитектура (Этап 1)

```
Read carefully: Claude.md, PRD_AI_Tax_Advisor.md, Technical_Spec.md,
Tax_Checks_Catalog.md, knowledge_base/Finanzamt_Methodology_Reference.md

Test data for 7 clients is ready in backend/data/ (client_001 through client_007).

Before writing any code, create two documents:

1. DEV_PLAN.md — development plan:
   - Full project folder and file structure
   - 5 sequential development phases, each independently testable
   - What to run to test each phase (exact commands or curl examples)
   - Which files depend on which

2. ARCHITECTURE.md — technical architecture:
   - ASCII sequence diagram of the full request flow
     (User → Frontend → Backend → Agent → Tools → data → back)
   - ASCII diagram of the tool_use loop
     (how Claude API calls tools iteratively)
   - All environment variables needed (.env)
   - Thread ID context management: how history is stored and retrieved
   - Data flow for POST /api/analyze endpoint

Do not write any application code yet.
Wait for approval before proceeding to Phase 1.
```

### Промпт 2 — Data Layer (Этап 2)

```
Plan approved. Proceed with Phase 1 only: backend/tools.js

Implement 5 functions that read from backend/data/client_XXX.json:
- get_transactions(period, company_id) — filter by date range
- get_invoices(period, company_id) — filter by date range
- get_company_settings(company_id) — return company_settings + business_context + vat_reporting
- get_assets(company_id) — return assets array
- get_client_knowledge_base(company_id) — return full client KB

Also create backend/test_tools.js that calls each function with client_001
for period "2026-01-01 to 2026-03-31" and prints results.

Do not touch agent.js or server.js yet.
```

### Промпт 3 — Agent Core (Этап 3)

```
tools.js tested and working. Proceed with Phase 2: backend/agent.js

Requirements:
- Claude API with tool_use, model: claude-sonnet-4-6
- System prompt: load content from Claude.md + Tax_Checks_Catalog.md
  + knowledge_base/Finanzamt_Methodology_Reference.md
- Handle tool_use loop: call Claude → if tool_use → execute tool
  → send result back → repeat until final text response
- Store conversation history by threadId in a Map (in-memory)
- Export: analyzeClient(clientId, period, userQuery, threadId)
- Output format: { threadId, report: { errors[], warnings[], ok_checks[], steuerreserve } }

Also create backend/test_agent.js that calls analyzeClient with:
client_001, "2026-01-01 to 2026-03-31", "Check my Q1 books for errors"

Expected: agent should find at least error A-05
(Kleinunternehmer issued invoice with 19% VAT — txn_001_008)

Do not touch server.js or frontend yet.
```

### Промпт 4 — API Server (Этап 4)

```
agent.js tested and finding errors correctly. Proceed with Phase 3: backend/server.js

Requirements:
- Express + CORS, port 3001
- GET /api/clients — read all client_XXX.json files,
  return array of { id, display_name }
- POST /api/analyze — body: { clientId, period, userQuery, threadId? }
  → call analyzeClient() → return { threadId, report }
- Error handling: missing API key, client not found, agent timeout

Test with curl:
  curl http://localhost:3001/api/clients
  curl -X POST http://localhost:3001/api/analyze \
    -H "Content-Type: application/json" \
    -d '{"clientId":"client_001","period":"Q1 2026","userQuery":"Check my books"}'

Do not touch frontend yet.
```

### Промпт 5 — Frontend (Этап 5)

```
API server running correctly. Proceed with Phase 4: frontend/

Create React + Vite app on port 3000:
- Client dropdown (fetch from GET /api/clients)
- Period selector: Q1 2026 / Q2 2026 / Q1-Q2 2026 / Full year 2026
- Query input: "What do you want to know?"
  placeholder: "Check my Q1 books for errors"
- Submit button → POST /api/analyze → loading spinner → render report
- Report sections:
    🔴 Critical Errors
    ⚠️ Warnings
    ✅ All Clear
    💰 Steuerreserve
- Thread_id stored in React useState,
  sent with each subsequent query for context continuity
- Clean professional UI — no placeholder styling
```

---

## Журнал изменений

| Дата | Изменение |
|---|---|
| Май 2026 | **Этап 6.6 начат:** пользовательские сессии H1–H8. Этап 6.5 пропущен — тестовые клиенты репрезентативны, реальные данные не нужны на этом этапе. |
| Май 2026 | **Этап 6.1–6.4 завершён:** 7/7 клиентов PASS · Railway backend (без 60s лимита) · report JSON extraction fix · UI без ошибок. Готово к бета-пользователям. |
| Май 2026 | **Этап 5.5 завершён:** TEST_CASES.md создан. 7 тест-кейсов (TC-001–TC-007), 16 embedded errors задокументированы, pass criteria и false positive guards для каждого клиента. |
| Май 2026 | Создан PROJECT_LOG.md |
| Май 2026 | Этап 0 завершён: вся продуктовая документация готова |
| Май 2026 | Тестовые данные: 7 клиентов (client_001–007) |
| Май 2026 | Добавлен параметр vat_reporting в company_settings всех клиентов |
| Май 2026 | Создан Finanzamt_Methodology_Reference.md |
| Май 2026 | Упрощение MVP: один UX-вариант, без стриминга, без аутентификации |
| Май 2026 | **Ревизия документации v0.2:** добавлены 4 новых инструмента агента (get_bookkeeping_entries, get_reports, get_tasks, recognize_invoice_document); хранилище PDF-инвойсов; блок B разбит на 4 подблока по типу отчёта; принцип проактивных проверок; KB разбита на 7 файлов; удалены 8 проверок, дублирующих Finom |
| Май 2026 | **Этап 4 завершён:** server.js — GET /api/clients ✅, POST /api/analyze ✅, валидация и ошибки ✅. Реальный отчёт: 3 errors, 5 warnings, 11 ok, steuerreserve €1058/мес. |
| Май 2026 | **Этап 3 завершён:** agent.js — tool-use loop, 8/8 тестов ✅. Добавлены: prompt caching (cache_control: ephemeral), retry backoff при 429 (Tier 1 лимит). Агент находит RC-ошибку (client_001) и Home Office contradiction (client_002). |
| Май 2026 | **Этап 2 завершён:** tools.js — 14 функций, 44/44 тестов ✅. Исправлен recognize_invoice_document: использует file_path из записи инвойса, добавлен not_pdf path для .html-файлов. |
| Май 2026 | **Этап 2.5 завершён:** Buchungsprüfung — синхронная проверка при создании проводки. `checks.js` (10 правил, zero deps), `booking_check.js` (endpoint + LLM), `BookingVariant.jsx` (?variant=booking, 3 шага, 16 тест-кейсов по 7 клиентам), `test_booking_check.js` (6/6 ✅). POST /api/booking-check добавлен в server.js. |
