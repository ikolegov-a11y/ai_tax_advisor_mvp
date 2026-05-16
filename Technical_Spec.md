# AI Tax Advisor — Техническая спецификация

**Статус:** Прототип  
**Версия:** 0.1  
**Дата:** Апрель 2026

---

## 1. Архитектура

```
┌──────────────────────────────────────────────────────────┐
│                    Finom Frontend                         │
│          Кнопка "Check my books" + Отчёт-чеклист         │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTP / Streaming
┌────────────────────────────▼─────────────────────────────┐
│               AI Tax Advisor Agent                        │
│  (LLM-агент с набором tools, системным промптом          │
│   и каталогом налоговых правил)                          │
└──────┬──────────────┬──────────────┬──────────────┬──────┘
       │              │              │              │
  [tool]          [tool]         [tool]         [tool]
get_transactions  get_invoices  get_company   get_assets
                              _settings
       │              │              │              │
┌──────▼──────────────▼──────────────▼──────────────▼──────┐
│                Finom Backend API                          │
│  (существующие endpoints + новый endpoint для активов)   │
└───────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│              Client Knowledge Base (новое)                │
│   JSON-хранилище доп. данных о клиенте:                   │
│   адреса, авто, семья, другие доходы                     │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Агент

### 2.1 Системный промпт (концепция)

Агент должен быть настроен как опытный немецкий Steuerberater. Ключевые инструкции:

- Язык ответа: немецкий (или язык интерфейса клиента)
- Стиль: профессиональный, конкретный, без воды
- Для каждой найденной проблемы: (1) что не так, (2) почему это проблема, (3) как исправить
- Различать severity: ERROR (явное нарушение) vs. WARNING (риск) vs. INFO (рекомендация)
- Не делать выводов о намерениях клиента — только о фактах
- Явный дисклеймер: агент не является аккредитованным Steuerberater

### 2.2 Инструкция по работе

1. Получить период проверки от пользователя
2. Вызвать все tools параллельно для сбора данных
3. Для каждого налогового правила из каталога (см. `Tax_Checks_Catalog.md`) выполнить проверку
4. Сгруппировать результаты по severity: ERROR → WARNING → OK
5. Сформировать структурированный отчёт

---

## 3. Существующие инструменты (tools)

### 3.1 `get_transactions(period, company_id)`

**Уже реализован в продакшене.**

Возвращает список транзакций за период:

```json
{
  "transactions": [
    {
      "id": "txn_001",
      "date": "2026-03-15",
      "amount": 5950.00,
      "currency": "EUR",
      "counterparty": "Müller GmbH",
      "category": "Office Supplies",
      "vat_rate": 0.19,
      "vat_amount": 950.00,
      "net_amount": 5000.00,
      "linked_invoice_id": "inv_012",
      "type": "expense",
      "notes": ""
    }
  ]
}
```

### 3.2 `get_invoices(period, company_id)`

**Уже реализован в продакшене.**

Возвращает инвойсы (исходящие и входящие):

```json
{
  "invoices": [
    {
      "id": "inv_012",
      "type": "incoming",
      "date": "2026-03-14",
      "amount_gross": 5950.00,
      "amount_net": 5000.00,
      "vat_rate": 0.19,
      "vat_amount": 950.00,
      "currency": "EUR",
      "supplier": "Müller GmbH",
      "supplier_vat_id": "DE123456789",
      "linked_transaction_id": "txn_001",
      "category": "Office Supplies"
    }
  ]
}
```

### 3.3 `get_company_settings(company_id)`

**Уже реализован в продакшене.**

Возвращает настройки из Accounting Settings:

```json
{
  "company_id": "co_abc123",
  "legal_form": "Freiberufler",
  "vat_status": "Kleinunternehmer",
  "vat_report_period": "quarterly",
  "region": "Bayern",
  "tax_number": "12/345/67890",
  "type_of_activity": "Software development",
  "gewst_required": false,
  "number_of_employees": 0,
  "business_name": "Max Mustermann",
  "address": "Musterstraße 1, 80331 München"
}
```

---

## 4. Новые инструменты (требуют реализации)

### 4.1 `get_assets(company_id)` ⚠️ Нужно разработать

Текущая ситуация: данные об амортизации и активах уже есть в Finom (раздел Amortisation), но нет API-эндпойнта для агента.

**Ожидаемый формат ответа:**

```json
{
  "assets": [
    {
      "id": "asset_001",
      "name": "Dell XPS Laptop",
      "category": "Technology",
      "start_date": "2026-01-10",
      "purchase_price": 1200.00,
      "amortization_period_years": 1,
      "annual_depreciation": 1200.00,
      "depreciated_to_date": 300.00,
      "remaining_value": 900.00,
      "status": "depreciating",
      "linked_transaction_id": "txn_005",
      "is_vehicle": false,
      "vehicle_details": null
    },
    {
      "id": "asset_002",
      "name": "BMW 3 Series 2023",
      "category": "Purchase Car",
      "start_date": "2025-06-01",
      "purchase_price": 35000.00,
      "amortization_period_years": 6,
      "annual_depreciation": 5833.33,
      "depreciated_to_date": 8750.00,
      "remaining_value": 26250.00,
      "status": "depreciating",
      "linked_transaction_id": "txn_088",
      "is_vehicle": true,
      "vehicle_details": {
        "engine_type": "petrol",
        "private_use": true,
        "usage_rate": 0.01,
        "msrp_gross": 42000.00
      }
    }
  ]
}
```

### 4.2 `get_client_knowledge_base(company_id)` ⚠️ Нужно разработать

Возвращает данные из Client Knowledge Base клиента. Подробный формат — в разделе 5.

---

## 5. Client Knowledge Base

### 5.1 Назначение

Хранилище данных о клиенте, которые не являются частью бухгалтерских операций, но необходимы для корректного налогового анализа. Состоит из двух слоёв:

**Личный профиль** — стандартные данные о физическом лице:
- Адреса для расчёта маршрутов (Pendlerpauschale)
- Данные об автомобиле для проверки расходов
- Семейный статус для проверки применимости вычетов
- Другие источники дохода для корректной оценки налоговой нагрузки

**Бизнес-контекст** — специфика деловой деятельности клиента. Без этого блока агент не может корректно применить налоговые правила: одни и те же транзакции могут быть ошибкой или нормой в зависимости от бизнес-модели. Примеры:
- Фрилансер с US-клиентами (Upwork, Toptal) → Reverse Charge, нет немецкого НДС на исходящие инвойсы
- Amazon FBA-продавец → OSS-VAT, складской учёт, marketplace-комиссии
- KSK-участник → особый режим социальных взносов
- Reseller цифровых продуктов → другая трактовка НДС на B2C

Агент **обязан учитывать бизнес-контекст** при каждой проверке и явно указывать, когда вывод зависит от него.

### 5.2 Схема данных

```json
{
  "company_id": "co_abc123",
  "updated_at": "2026-04-15T10:00:00Z",

  "business_context": {
    "sales_channels": ["own_website", "upwork"],
    "client_geography": ["de", "eu", "international"],
    "has_eu_b2b_clients": true,
    "has_international_clients": true,
    "uses_marketplace": false,
    "marketplace_name": null,
    "sells_digital_goods": false,
    "sells_physical_goods": false,
    "has_ksk_membership": false,
    "is_licensed_professional": false,
    "professional_license_type": null,
    "reverse_charge_applicable": true,
    "oss_vat_registered": false,
    "notes": "Фрилансер, работает преимущественно с US/UK-клиентами через Upwork. Выставляет инвойсы в EUR и USD. Reverse Charge применяется ко всем EU B2B транзакциям."
  },

  "addresses": {
    "home": {
      "street": "Wohnstraße 5",
      "city": "München",
      "postal_code": "80333",
      "country": "DE"
    },
    "office": {
      "street": "Büroallee 12",
      "city": "München",
      "postal_code": "80339",
      "country": "DE",
      "is_home_office": false,
      "home_office_room_sqm": null,
      "total_apartment_sqm": null
    }
  },

  "commute": {
    "days_per_week": 3,
    "distance_km_one_way": 8.4,
    "transport_mode": "private_car"
  },

  "vehicles": [
    {
      "id": "vehicle_001",
      "type": "private",
      "make": "VW",
      "model": "Golf",
      "year": 2020,
      "engine_type": "petrol",
      "msrp_gross": null,
      "linked_asset_id": null,
      "notes": "Используется для клиентских визитов (Kilometerpauschale)"
    }
  ],

  "family_status": {
    "marital_status": "single",
    "children_count": 0,
    "children": []
  },

  "other_income_sources": [
    {
      "type": "employment",
      "employer": "Acme Corp",
      "annual_gross": 24000.00,
      "notes": "Основная работа, параллельно ведётся фриланс"
    }
  ],

  "home_office": {
    "uses_home_office_pauschale": true,
    "has_dedicated_room": false,
    "room_sqm": null,
    "apartment_sqm": null,
    "office_days_count": 57
  }
}
```

### 5.3 UI для заполнения Client KB

Для прототипа: отдельный раздел **"Мой профиль"** или **"Настройки для Tax Advisor"** в Finom Accounting.

Структура форм:

**Блок 1 — Бизнес-контекст (новый, приоритетный):**
- Каналы продаж: мультиселект (собственный сайт, Amazon, Etsy, Upwork, Fiverr, другое)
- Тип клиентов: мультиселект (немецкие B2B, EU B2B, международные, B2C)
- Продаёте ли цифровые / физические товары: чекбокс
- KSK-участник: чекбокс
- Работаете ли с зарубежными клиентами (не DE): чекбокс → если да, появляется поле про Reverse Charge
- Свободный текст: "Расскажите об особенностях вашего бизнеса" (до 500 символов)

**Блок 2 — Личный профиль:**
- **Адреса:** поля домашнего и рабочего адреса (с Google Maps автодополнением)
- **Автомобиль:** тип (частный/бизнес), марка/модель, двигатель
- **Home Office:** переключатель "есть выделенная комната" → поля m²
- **Семья:** семейный статус, дети (год рождения)
- **Другие доходы:** тип (наёмный труд / аренда / капитал), сумма

**Для Phase 0:** данные бизнес-контекста 10 beta-клиентов заполняются вручную при загрузке mock-данных. Это один из ключевых параметров для проверки гипотезы H1 — насколько сильно контекст влияет на качество находок агента.

---

## 6. Системный промпт агента

```
Ты — AI Tax Advisor в бухгалтерском приложении Finom для предпринимателей в Германии.
Твоя задача: проанализировать бухгалтерские данные клиента за указанный период и 
выявить ошибки, противоречия и риски с точки зрения немецкого налогового права.

СТИЛЬ РАБОТЫ:
- Будь конкретным: указывай конкретные ID транзакций, инвойсов, сумм, дат
- Различай severity: ERROR (явное нарушение), WARNING (риск/неопределённость), OK (всё верно)
- Для каждой проблемы: объясни что не так → почему это важно → что сделать
- Не используй юридический жаргон без объяснений
- Если данных недостаточно для вывода — скажи об этом, не придумывай

ПРАВОВЫЕ РАМКИ:
- Применимое право: немецкое налоговое законодательство (EStG, UStG, GewStG)
- Целевые клиенты: Einzelunternehmer (Freiberufler, Gewerbetreibender в лимитах EÜR)
- Метод учёта: Einnahmenüberschussrechnung (EÜR), кассовый метод
- НДС: стандарт 19%/7%, или Kleinunternehmerregelung (§19 UStG)

ВАЖНО:
- Ты не являешься аккредитованным Steuerberater
- Твои выводы носят информационный характер
- При сложных ситуациях рекомендуй обратиться к специалисту

ФОРМАТ ВЫВОДА:
- Верни структурированный JSON с полями: errors[], warnings[], ok_checks[]
- Каждый элемент: { id, title, description, affected_items[], recommendation, deep_link }
- Затем сформируй читаемый отчёт на основе JSON
```

---

## 7. Tax Rules Reference

### 7.1 Назначение

`Tax_Rules_Reference.md` — авторитетный справочный документ, который агент получает как контекст при каждом запросе. Цель: **исключить галлюцинации и расхождения** между разными LLM-моделями при интерпретации немецкого налогового права. Опыт показывает, что разные модели дают разные версии плана счетов SKR-04, порогов и правил — захардкоженный источник истины решает эту проблему.

> Этот документ содержит только налоговое законодательство и бухгалтерские стандарты. Описание продукта Finom, поддерживаемых функций и пользовательских сценариев хранится в отдельном хранилище — Support Knowledge Base.

### 7.2 Состав документа

**1. SKR-04 — полный актуальный план счетов**
Стандартный конторский план счетов (Standardkontenrahmen 04), применяемый для Freiberufler и сервисных Einzelunternehmer. Включает номера счетов, названия, группировку по разделам. Обновляется при выходе новых редакций DATEV/BStBK. Причина включения: разные LLM дают несовместимые описания SKR-04, что приводит к ошибкам при категоризации транзакций.

**2. Актуальные пороговые значения (обновляются ежегодно)**
- Kleinunternehmer: порог предыдущего года (€25 000 с 2025) и текущего года (€100 000)
- Grundfreibetrag, Kinderfreibetrag, Solidaritätszuschlag-Grenze
- Verpflegungspauschalen (суточные внутри страны и за рубежом по странам)
- GWG-лимит (€800 нетто)
- Pendlerpauschale (€0.30/км первые 20 км, €0.38/км свыше)
- Kilometerpauschale для командировок (€0.30/км)
- Home Office Pauschale (€6/день, макс. €1 260/год)
- AfA-Tabellen — стандартные сроки амортизации для 20+ категорий активов

**3. Шаблоны и структура деклараций**
- Структура форм: UStVA (Umsatzsteuervoranmeldung), UStE, EÜR (Anlage EÜR + AVEÜR), Gewerbesteuererklärung
- Перечень обязательных полей каждой формы и правила их заполнения
- Актуальные коды строк деклараций (Kennzahlen) — для корректного сопоставления данных с полями отчётов

**4. Тексты ключевых законодательных норм**
Релевантные параграфы с оригинальным немецким текстом:
- §14 UStG — требования к инвойсу для Vorsteuerabzug
- §19 UStG — Kleinunternehmerregelung
- §7g EStG — Investitionsabzugsbetrag
- §4 Abs. 5 EStG — ограничения на вычет расходов (Bewirtung, Geschenke и т.д.)
- §6 Nr. 4 StBerG — допустимые механические операции без лицензии
- Релевантные части AfA-Tabellen BMF

**5. Описания налоговых правил и практики применения**
Текстовые описания правил в формате «вопрос → правило → исключения → типичные ошибки». Примеры:
- Когда Firmenwagen требует регистрации как актив (>50% деловое использование)
- Как работает 1%-правило и когда применять 0.5% и 0.25%
- Условия одновременного применения Home Office Pauschale и аренды офиса
- Правила документирования Bewirtungskosten
- Различие между Freiberufler и Gewerbetreibender: критерии и последствия
- Порядок перехода с Kleinunternehmer на стандартный НДС

### 7.3 Принцип обновления

Документ обновляется **раз в год** после выхода Jahressteuergesetz (как правило, декабрь–январь). Ответственный: PM проекта. При обновлении порогов — агент автоматически использует новые значения без изменения кода.

---

## 8. Каталог налоговых правил

Полный каталог — в файле `Tax_Checks_Catalog.md`.

**Краткая сводка по блокам:**

| Блок | Кол-во правил | Severity |
|---|---|---|
| A: Инвойс ↔ Проводка | 8 правил | ERROR / WARNING |
| B: Противоречия в учёте | 9 правил | ERROR / WARNING |
| C: Противоречия в отчётности | 8 правил | ERROR / WARNING |
| Итого | 25 правил | |

---

## 9. План реализации

### Phase 0 — Concept Validation (4–6 недель)

Standalone-приложение для проверки концепта на реальных пользователях. **Не интегрируется в production Finom.**

**Архитектура Phase 0:**
```
[Тестовый UI] → [AI Agent] → [Mock API Server]
                                    │
                          ┌─────────┴─────────┐
                     [Mock DB]           [Mock DB]
                  транзакции 10        инвойсы 10
                  beta-клиентов        beta-клиентов
```

- [ ] Завербовать 10 beta-клиентов из действующих пользователей Finom (с согласием на обработку данных)
- [ ] Выгрузить и загрузить их реальные данные в mock-таблицы (транзакции, инвойсы, настройки компании)
- [ ] Реализовать mock API, структурно идентичный production-эндпойнтам
- [ ] Собрать тестовый UI: два варианта (виджет-чеклист / проактивный чат)
- [ ] Написать системный промпт агента + подключить Tax Rules Reference
- [ ] Провести пользовательские сессии (45–60 мин, 10 участников)
- [ ] Замерить гипотезы H1–H8 (см. PRD, раздел 0.3)
- [ ] Синтез результатов → решение о переходе в разработку

**Критерий перехода:** H1 + H3 + H4 подтверждены.

### Фаза 1 — Данные (1–2 недели)

- [ ] Реализовать `get_assets()` tool (API-эндпойнт для агента)
- [ ] Создать схему и хранилище Client KB
- [ ] Разработать простую форму заполнения Client KB
- [ ] Заполнить Client KB для тестового аккаунта вручную

### Фаза 2 — Агент (2–3 недели)

- [ ] Написать системный промпт агента
- [ ] Имплементировать каталог правил (Tax_Checks_Catalog)
- [ ] Реализовать параллельный вызов tools
- [ ] Настроить форматирование выходного отчёта
- [ ] Протестировать на реальном аккаунте в продакшене

### Фаза 3 — UI (1–2 недели)

- [ ] Добавить кнопку "Check my books" в Accounting
- [ ] Реализовать отображение отчёта-чеклиста
- [ ] Deep links из отчёта в нужные разделы Finom
- [ ] Форма Client KB в настройках
- [ ] Функция экспорта отчёта в PDF

### Фаза 4 — Тестирование (1 неделя)

- [ ] Тест на ≥ 5 реальных аккаунтах
- [ ] Замер false positive / false negative
- [ ] Пользовательские интервью (понятность формулировок)
- [ ] Итерация по результатам

**Итого оценка прототипа: 5–8 недель**

---

## 10. Технологический стек (рекомендации)

| Компонент | Рекомендация | Обоснование |
|---|---|---|
| LLM | Claude claude-sonnet-4-6 (Anthropic API) | Уже используется в Finom, поддерживает tool use |
| Tool calling | Anthropic Tool Use API | Нативная поддержка параллельных вызовов |
| Client KB хранение | PostgreSQL (новая таблица) / JSON в S3 | Простота для прототипа |
| Форматирование отчёта | Markdown → HTML рендер | Читаемо, легко стилизовать |
| PDF экспорт | WeasyPrint / Puppeteer | Стандартные решения |

---

## 11. Риски и митигация

| Риск | Вероятность | Митигация |
|---|---|---|
| Высокий false positive rate (агент "находит" несуществующие ошибки) | Средняя | Строгие правила + ручной review перед релизом |
| Пользователь принимает отчёт за юридическое заключение | Высокая | Явный дисклеймер + формулировка "рекомендация, не заключение" |
| Клиент не заполняет Client KB → ухудшение качества | Высокая | Постепенное улучшение: начать с данных, которые есть в системе |
| LLM галлюцинирует налоговые правила | Средняя | Правила хардкодить в system prompt, не полагаться на "знания" модели |

---

## 12. Хранилище файлов инвойсов

### 12.1 Назначение

Агент должен не только сравнивать структурированные данные (JSON), но и проверять **реальный документ** — PDF или изображение инвойса, которое загрузил пользователь. Это позволяет обнаруживать расхождения между тем, что сохранено в системе, и тем, что фактически написано на бумаге.

Это критически важно для проверки A-09 (файл инвойса ≠ сохранённым данным) и B-ZM-02 (отсутствие фразы Reverse Charge в документе).

### 12.2 Структура хранилища

```
backend/data/
├── client_001.json
├── client_002.json
│   ...
└── invoice_files/
    ├── client_001/
    │   ├── inv_001_001.pdf     ← файл входящего/исходящего инвойса
    │   ├── inv_001_002.pdf
    │   └── inv_001_008.pdf     ← ожидаемая ошибка A-05: KU + НДС
    ├── client_002/
    │   └── ...
    └── client_007/
        └── ...
```

**Именование файлов:** `{invoice_id}.pdf` или `{invoice_id}.png` — совпадает с полем `id` в структуре инвойса.

### 12.3 Расширение схемы инвойса

Добавить поле `file_path` в запись инвойса:

```json
{
  "id": "inv_001_008",
  "type": "outgoing",
  "date": "2026-03-14",
  "amount_gross": 4760.00,
  "vat_rate": 0.19,
  "file_path": "invoice_files/client_001/inv_001_008.pdf",
  "file_available": true
}
```

Если `file_available == false` или `file_path == null` — агент пропускает проверку A-09 для этого инвойса и не генерирует false positive.

### 12.4 Процесс генерации тестовых файлов (Phase 0)

Для Phase 0 тестовые PDF инвойсы генерируются вручную (или через инструмент генерации счетов):
- Часть инвойсов намеренно содержит расхождения с JSON-данными (для проверки A-09)
- Часть EU B2B инвойсов не содержат фразу Reverse Charge (для проверки B-ZM-02)
- Один инвойс клиента client_001 содержит НДС 19% при статусе Kleinunternehmer (для A-05 + A-09)

---

## 13. Дополнительные инструменты агента

### 13.1 `recognize_invoice_document(invoice_id)` ⭐ NEW

**Описание:** Читает файл инвойса (PDF или изображение), применяет Claude Vision с специализированным промптом распознавания и возвращает структурированные данные.

**Специализированный промпт распознавания** (встроен в описание инструмента):

```
You are a German invoice parser. Extract the following fields from the invoice document.
Be precise — copy values exactly as written.

Required fields:
- invoice_number: invoice/Rechnungs-Nr (string)
- date: invoice date in ISO format YYYY-MM-DD
- supplier_name: issuer company name (string)
- customer_name: recipient company name (string)
- amount_gross: total amount including VAT (number, EUR)
- amount_net: net amount without VAT (number, EUR)
- vat_rate: VAT rate as decimal (0.19, 0.07, or 0.00)
- vat_amount: VAT amount in EUR (number)
- supplier_tax_number: Steuernummer or USt-IdNr of the issuer (string or null)
- customer_vat_id: VAT ID of the customer/buyer (string or null)
- has_reverse_charge_note: true if document contains "Reverse Charge" or
  "Steuerschuldnerschaft des Leistungsempfängers" (boolean)
- has_kleinunternehmer_note: true if document contains "§19 UStG" disclaimer (boolean)
- line_items: array of { description, quantity, unit_price, vat_rate, total }

If a field is not found, return null. Do not guess.
Return JSON only, no explanation.
```

**Входные параметры:** `{ invoice_id: string }`

**Логика:**
1. Найти `file_path` по `invoice_id` в данных клиента
2. Если файл не найден — вернуть `{ error: "file_not_found" }`
3. Прочитать файл (PDF → изображение через конвертацию, или изображение напрямую)
4. Вызвать Claude Vision API с файлом + промптом распознавания
5. Вернуть структурированный JSON с распознанными полями

**Возвращает:**
```json
{
  "invoice_id": "inv_001_008",
  "recognized": {
    "invoice_number": "2026-008",
    "date": "2026-03-14",
    "supplier_name": "Anna Müller IT-Beratung",
    "customer_name": "TechCorp München GmbH",
    "amount_gross": 4760.00,
    "amount_net": 4000.00,
    "vat_rate": 0.19,
    "vat_amount": 760.00,
    "supplier_tax_number": "14/234/56789",
    "customer_vat_id": null,
    "has_reverse_charge_note": false,
    "has_kleinunternehmer_note": false
  },
  "recognition_confidence": "high"
}
```

**Для Phase 0 (mock):** Если Claude Vision API недоступен, инструмент читает pre-computed файл `invoice_files/client_XXX/inv_XXX_recognized.json`. Это позволяет тестировать логику сравнения без реального OCR.

---

### 13.2 `get_bookkeeping_entries(period, company_id)` ⭐ NEW

**Описание:** Возвращает бухгалтерские проводки (Buchungssätze) за период. Отличие от транзакций: проводки — это учётный слой. Один платёж может порождать несколько проводок (split), амортизация создаёт проводки без платежа.

**Ожидаемый формат:**

```json
{
  "entries": [
    {
      "id": "entry_001_001",
      "date": "2026-01-10",
      "period": "2026-01",
      "type": "income",
      "description": "Honorar IT-Beratung Januar",
      "amount": 4200.00,
      "category": "Revenue",
      "account_code": "8400",
      "vat_rate": 0.00,
      "vat_amount": 0.00,
      "net_amount": 4200.00,
      "linked_transaction_id": "txn_001_001",
      "linked_invoice_id": "inv_001_001",
      "is_private_use": false,
      "notes": ""
    },
    {
      "id": "entry_001_015",
      "date": "2026-01-31",
      "period": "2026-01",
      "type": "depreciation",
      "description": "AfA Dell XPS Laptop",
      "amount": 33.33,
      "category": "Depreciation",
      "account_code": "4831",
      "vat_rate": 0.00,
      "vat_amount": 0.00,
      "net_amount": 33.33,
      "linked_transaction_id": null,
      "linked_invoice_id": null,
      "linked_asset_id": "asset_001",
      "is_private_use": false,
      "notes": "Monatliche AfA: 1200 € / 36 Monate"
    }
  ]
}
```

**Типы проводок (`type`):**
- `income` — поступление / Einnahme
- `expense` — расход / Ausgabe
- `depreciation` — амортизация / AfA
- `private_use` — частное использование (Privatentnahme/Privateinlage)
- `adjustment` — корректировка

**Примечание:** Для Phase 0 `bookkeeping_entries` добавляются в каждый `client_XXX.json` рядом с `transactions`. Полная схема — в DEV_PLAN.md.

---

### 13.3 `get_reports(company_id, period?)` ⭐ NEW

**Описание:** Возвращает данные о созданных налоговых отчётах и их статусах. Используется для проверок C-04 (период UStVA) и для контекста при анализе: агент видит, что уже подано, что в черновике, что просрочено.

**Ожидаемый формат:**

```json
{
  "reports": [
    {
      "id": "report_001_q1_ustv",
      "type": "UStVA",
      "period": "2026-Q1",
      "status": "submitted",
      "submitted_at": "2026-04-23T14:30:00Z",
      "due_date": "2026-04-25",
      "is_overdue": false,
      "total_revenue_taxable": 0,
      "total_vat_collected": 0,
      "total_vorsteuer": 0,
      "net_vat_payable": 0,
      "file_id": null,
      "notes": "Kleinunternehmer — keine Umsatzsteuer"
    },
    {
      "id": "report_001_eur_2025",
      "type": "EÜR",
      "period": "2025",
      "status": "draft",
      "submitted_at": null,
      "due_date": "2026-07-31",
      "is_overdue": false,
      "total_income": 38400.00,
      "total_expenses": 12300.00,
      "profit": 26100.00,
      "file_id": null,
      "notes": ""
    }
  ]
}
```

**Статусы отчёта (`status`):**
- `draft` — черновик, не подан
- `submitted` — подан в Finanzamt
- `accepted` — принят Finanzamt
- `overdue` — срок истёк, не подан

---

### 13.4 `get_tasks(company_id)` ⭐ NEW

**Описание:** Возвращает список задач пользователя, связанных с налоговым учётом. Агент использует задачи для контекста: если задача "Подать UStVA Q1" уже просрочена — это важный сигнал при анализе.

**Ожидаемый формат:**

```json
{
  "tasks": [
    {
      "id": "task_001_ustv_q1",
      "type": "submit_report",
      "title": "UStVA Q1 2026 einreichen",
      "status": "overdue",
      "due_date": "2026-04-25",
      "linked_report_id": "report_001_q1_ustv",
      "linked_finding_id": null,
      "created_at": "2026-04-01T09:00:00Z",
      "completed_at": null,
      "notes": "Срок истёк 25.04.2026"
    },
    {
      "id": "task_001_fix_phone",
      "type": "fix_bookkeeping",
      "title": "Разделить расходы телефон/интернет (Business vs. Private)",
      "status": "in_progress",
      "due_date": null,
      "linked_report_id": null,
      "linked_finding_id": "B-06",
      "created_at": "2026-04-28T10:00:00Z",
      "completed_at": null,
      "notes": ""
    }
  ]
}
```

**Статусы задачи (`status`):**
- `pending` — ожидает выполнения
- `in_progress` — в процессе
- `completed` — выполнена
- `overdue` — просрочена

**Типы задач (`type`):**
- `submit_report` — подать отчёт
- `fix_bookkeeping` — исправить проводку / запись
- `review_finding` — проверить находку агента
- `upload_document` — загрузить документ

---

## 14. База знаний агента — структура файлов

### 14.1 Принцип разбивки

Единый `Tax_Rules_Reference.md` слишком объёмен для контекста агента и сложен для навигации. Вместо него — набор **специализированных коротких файлов**, каждый с однозначным заголовком. Агент может запросить нужный файл только тогда, когда это необходимо, не загружая весь объём в контекст.

Принципы разбивки:
- Один файл = одна тема / одна законодательная область
- Первые 3 строки файла содержат: тему, применимость, дату обновления
- Файл обновляется **раз в год** после Jahressteuergesetz

### 14.2 Структура knowledge_base/

```
knowledge_base/
│
├── Finanzamt_Methodology_Reference.md     ← уже существует
│   Тема: методы проверки ELSTER/RMS, Betriebsprüfung, Richtsatzsammlung
│
├── Tax_Thresholds_Current.md              ← СОЗДАТЬ
│   Тема: актуальные пороговые значения (Kleinunternehmer, GWG, Pauschalen, AfA-Tabellen)
│   Обновляется: ежегодно (январь)
│
├── SKR04_Account_Plan.md                  ← СОЗДАТЬ
│   Тема: план счетов SKR-04, номера счетов, группировка по разделам
│   Обновляется: при выходе новых редакций DATEV
│
├── VAT_Rules_Reference.md                 ← СОЗДАТЬ
│   Тема: §14 UStG (Pflichtangaben), §19 UStG (Kleinunternehmer), Reverse Charge,
│         ZM-Meldepflicht, OSS-VAT, 7%/19% разграничение
│
├── Depreciation_AfA_Reference.md          ← СОЗДАТЬ
│   Тема: AfA-Tabellen полные по категориям, GWG-Sofortabschreibung, 1%-Regel Firmenwagen,
│         Электромобили (0.25%-Regel), линейный vs. деgressiver метод
│
├── Deduction_Rules_Reference.md           ← СОЗДАТЬ
│   Тема: §4 Abs. 5 EStG (Bewirtung 70%, Geschenke), Home Office (§4 Abs. 5 Nr. 6b),
│         Pendlerpauschale, Verpflegungspauschalen, Kilometerpauschale
│
└── Report_Forms_Reference.md              ← СОЗДАТЬ
    Тема: структура форм UStVA, EÜR (Anlage EÜR + AVEÜR), ZM, GewSt-Erklärung;
          Kennzahlen (коды строк), обязательные поля, порядок заполнения
```

### 14.3 Формат каждого KB-файла

```markdown
# [Название темы]
**Применимо к:** Einzelunternehmer, EÜR, DE-рынок
**Обновлено:** [год]
**Источник:** [закон / BMF-Schreiben / AfA-Tabellen]

---
[содержание — правила, таблицы, параграфы]
```

### 14.4 Как агент использует KB

В системном промпте агента:
- Базово загружаются: `Tax_Checks_Catalog.md` + `Finanzamt_Methodology_Reference.md`
- По необходимости (tool call или explicit reference): агент запрашивает нужный KB-файл

Для Phase 0 все файлы загружаются в системный промпт полностью (нет RAG/embeddings).
В продакшене — переход на retrieval-based подход при превышении context window.

---

## 15. Обновлённый полный список инструментов агента

| Инструмент | Версия | Назначение | Данные |
|---|---|---|---|
| `get_transactions` | existing | Банковские движения за период | `transactions[]` из client JSON |
| `get_invoices` | existing | Входящие и исходящие инвойсы | `invoices[]` из client JSON |
| `get_company_settings` | existing | Настройки компании + бизнес-контекст | `company_settings` + `business_context` |
| `get_assets` | existing | Активы и амортизация | `assets[]` из client JSON |
| `get_client_knowledge_base` | existing | Личный профиль + бизнес-контекст | `client_kb` раздел из client JSON |
| `get_bookkeeping_entries` | **NEW** | Бухгалтерские проводки за период | `bookkeeping_entries[]` из client JSON |
| `get_reports` | **NEW** | Налоговые отчёты и их статусы | `vat_reporting.reports[]` из client JSON |
| `get_tasks` | **NEW** | Задачи пользователя и их статусы | `tasks[]` из client JSON |
| `recognize_invoice_document` | **NEW** | Распознавание файла инвойса (OCR/Vision) | PDF/image из `invoice_files/` |
