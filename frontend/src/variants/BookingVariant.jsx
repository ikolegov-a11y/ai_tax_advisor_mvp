import { useState, useRef } from 'react';

// ---------------------------------------------------------------------------
// Hardcoded test cases per client
// display: data shown in the simulated booking flow (steps 1–2)
// ---------------------------------------------------------------------------
const INVOICE_TEST_CASES = {
  client_001: [
    {
      invoice_id: 'inv_001_006', entry_id: 'entry_001_009', transaction_id: null,
      label: 'OpenAI Ireland — Reverse Charge?',
      expectError: true,
      display: {
        counterparty: 'OpenAI Ireland Limited',
        amount: '19,33 €', vat_rate: '0 %', type: 'Incoming Invoice', country: 'Ireland (IE)',
        account_code: '4980', account_name: 'Software & Lizenzen / SaaS',
      },
    },
    {
      invoice_id: 'inv_001_005', entry_id: 'entry_001_008', transaction_id: null,
      label: 'DataStream Berlin — correct entry',
      expectError: false,
      display: {
        counterparty: 'DataStream Berlin GmbH',
        amount: '4.500,00 €', vat_rate: '0 %', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8400', account_name: 'Erlöse aus Leistungen §19 UStG',
      },
    },
    {
      invoice_id: 'inv_001_003', entry_id: 'entry_001_004', transaction_id: null,
      label: 'Office equipment 19% DE',
      expectError: false,
      display: {
        counterparty: 'Büro-Komplett GmbH',
        amount: '1.299,00 €', vat_rate: '19 %', type: 'Incoming Invoice', country: 'Germany (DE)',
        account_code: '0680', account_name: 'Betriebs- und Geschäftsausstattung',
      },
    },
  ],
  client_002: [
    {
      invoice_id: 'inv_002_001', entry_id: null, transaction_id: null,
      label: 'Agentur Kreativ GmbH — correct',
      expectError: false,
      display: {
        counterparty: 'Agentur Kreativ GmbH',
        amount: '4.165,00 €', vat_rate: '19 %', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8400', account_name: 'Erlöse aus Leistungen 19 % USt',
      },
    },
    {
      invoice_id: 'inv_002_002', entry_id: null, transaction_id: null,
      label: 'Adobe IE — RC Check',
      expectError: true,
      display: {
        counterparty: 'Adobe Systems Software Ireland Ltd',
        amount: '89,42 €', vat_rate: '0 %', type: 'Incoming Invoice', country: 'Ireland (IE)',
        account_code: '6815', account_name: 'Bürobedarf',
      },
    },
  ],
  client_003: [
    {
      invoice_id: 'inv_003_008', entry_id: null, transaction_id: null,
      label: 'Amazon Payout — Missing commission?',
      expectError: true,
      display: {
        counterparty: 'Amazon Payments Europe S.C.A.',
        amount: '967,60 €', vat_rate: '19 %', type: 'Incoming Invoice', country: 'Luxembourg (LU)',
        account_code: '8400', account_name: 'Erlöse Warenverkauf',
      },
    },
    {
      invoice_id: 'inv_003_004', entry_id: null, transaction_id: null,
      label: 'Shipping supplies DE — correct',
      expectError: false,
      display: {
        counterparty: 'Packiro GmbH',
        amount: '890,00 €', vat_rate: '19 %', type: 'Incoming Invoice', country: 'Germany (DE)',
        account_code: '6750', account_name: 'Verpackungsmaterial',
      },
    },
  ],
  client_004: [
    {
      invoice_id: 'inv_004_006', entry_id: 'entry_004_008', transaction_id: null,
      label: 'Progmatic PL — RC not applied',
      expectError: true,
      display: {
        counterparty: 'Progmatic Sp. z o.o.',
        amount: '357,00 €', vat_rate: '0 %', type: 'Incoming Invoice', country: 'Poland (PL)',
        account_code: '6825', account_name: 'IT-Dienstleistungen / Fremdleistungen',
      },
    },
    {
      invoice_id: 'inv_004_001', entry_id: null, transaction_id: null,
      label: 'Consulting fee DE — correct',
      expectError: false,
      display: {
        counterparty: 'Commerzbank AG',
        amount: '17.850,00 €', vat_rate: '19 %', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8400', account_name: 'Erlöse aus Beratungsleistungen',
      },
    },
  ],
  client_005: [
    {
      invoice_id: 'inv_005_007', entry_id: 'entry_005_camera', transaction_id: null,
      label: 'Canon EOS R5 — Low-value asset limit exceeded',
      expectError: true,
      display: {
        counterparty: 'Foto Koch GmbH',
        amount: '2.856,00 €', vat_rate: '19 %', type: 'Incoming Invoice', country: 'Germany (DE)',
        account_code: '6830', account_name: 'Büroausstattung (als Aufwand)',
      },
    },
    {
      invoice_id: 'inv_005_001', entry_id: null, transaction_id: null,
      label: 'Photo job §19 — correct',
      expectError: false,
      display: {
        counterparty: 'WeddingDream GbR',
        amount: '800,00 €', vat_rate: '0 %', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8400', account_name: 'Erlöse aus Leistungen §19 UStG',
      },
    },
  ],
  client_006: [
    {
      invoice_id: 'inv_006_003', entry_id: 'entry_006_003', transaction_id: null,
      label: 'TechSolutions Wien AT — no VAT ID',
      expectError: true,
      display: {
        counterparty: 'TechSolutions Wien GmbH',
        amount: '6.000,00 €', vat_rate: '0 %', type: 'Outgoing Invoice', country: 'Austria (AT)',
        account_code: '8120', account_name: 'Steuerfreie EU-Umsätze (Reverse Charge)',
      },
    },
    {
      invoice_id: 'inv_006_008', entry_id: 'entry_006_rental', transaction_id: null,
      label: 'Camera rental Klaus Weber — correct',
      expectError: false,
      display: {
        counterparty: 'Klaus Weber',
        amount: '500,00 €', vat_rate: '19 %', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8510', account_name: 'Mieteinnahmen / Verleih',
      },
    },
  ],
  client_007: [
    {
      invoice_id: 'inv_007_004', entry_id: 'entry_007_internet', transaction_id: null,
      label: 'Telekom — VAT mismatch invoice/entry',
      expectError: true,
      display: {
        counterparty: 'Telekom Deutschland GmbH',
        amount: '44,99 €', vat_rate: '19 %', type: 'Incoming Invoice', country: 'Germany (DE)',
        account_code: '4920', account_name: 'Telefon & Internet',
      },
    },
    {
      invoice_id: 'inv_007_011', entry_id: 'entry_007_011', transaction_id: null,
      label: 'Thomas Bergmann — §19 vs. standard VAT',
      expectError: true,
      display: {
        counterparty: 'Thomas Bergmann',
        amount: '320,00 €', vat_rate: '0 % (§19)', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8400', account_name: 'Erlöse §19 UStG',
      },
    },
    {
      invoice_id: 'inv_007_010', entry_id: 'entry_007_010', transaction_id: null,
      label: 'Petra Hoffmann — correct §19 entry',
      expectError: false,
      display: {
        counterparty: 'Petra Hoffmann',
        amount: '240,00 €', vat_rate: '0 % (§19)', type: 'Outgoing Invoice', country: 'Germany (DE)',
        account_code: '8400', account_name: 'Erlöse §19 UStG',
      },
    },
  ],
};

const CLIENTS = [
  { id: 'client_001', name: 'Anna Müller — IT-Freelancer' },
  { id: 'client_002', name: 'Thomas Schneider — Grafikdesigner' },
  { id: 'client_003', name: 'Maria Schmidt — Online-Shop / Amazon FBA' },
  { id: 'client_004', name: 'Peter Wagner — Unternehmensberater' },
  { id: 'client_005', name: 'Lisa Braun — Fotografin' },
  { id: 'client_006', name: 'Michael Fischer — Software-Entwickler' },
  { id: 'client_007', name: 'Sarah Klein — Online-Yoga-Trainerin' },
];

// Parse markdown bold (**text**) in LLM explanation into <strong> elements
function renderExplanation(text) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------
function StepIndicator({ step }) {
  const steps = [
    { num: 1, label: 'Invoice\nRecognized' },
    { num: 2, label: 'Category\nSet' },
    { num: 3, label: 'Booking\nCheck' },
  ];
  return (
    <div className="booking-steps">
      {steps.map(s => {
        const active = step === s.num;
        const done   = step > s.num;
        return (
          <div key={s.num} className={`booking-step${active ? ' active' : ''}${done ? ' done' : ''}`}>
            <div className="booking-step-num">{done ? '✓' : s.num}</div>
            <div className="booking-step-label" style={{ whiteSpace: 'pre-line' }}>{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finding card
// ---------------------------------------------------------------------------
function FindingBlock({ finding, explanation, dismissed, onDismiss }) {
  if (dismissed) return null;
  const isError = finding.severity === 'ERROR';
  const cls     = isError ? 'error' : 'warning';

  return (
    <div className={`booking-finding ${cls}`}>
      <div className="booking-finding-header">
        <span className={`booking-severity ${cls}`}>
          {isError ? 'Error' : 'Warning'}
        </span>
        <span className="booking-rule-id">{finding.check_id}</span>
        {finding.rule_reference && (
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{finding.rule_reference}</span>
        )}
      </div>
      {explanation && (
        <div className="booking-finding-body">
          <div className="booking-explanation">{renderExplanation(explanation)}</div>
          <div className="booking-finding-actions">
            {isError && (
              <button className="btn-fix" disabled title="Not available in this MVP version">
                Fix Now
              </button>
            )}
            {!isError && (
              <button className="btn-dismiss" onClick={onDismiss}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function BookingVariant() {
  const [clientId, setClientId]         = useState('client_001');
  const [selectedCase, setSelectedCase] = useState(INVOICE_TEST_CASES['client_001'][0]);
  const [step, setStep]                 = useState(0);   // 0=idle 1=recognized 2=categorized 3=checking 4=done
  const [result, setResult]             = useState(null);
  const [error, setError]               = useState('');
  const [dismissed, setDismissed]       = useState(new Set());
  const timerRef                        = useRef(null);

  function selectClient(id) {
    setClientId(id);
    const cases = INVOICE_TEST_CASES[id] ?? [];
    setSelectedCase(cases[0] ?? null);
    resetFlow();
  }

  function selectCase(label) {
    const cases = INVOICE_TEST_CASES[clientId] ?? [];
    const found = cases.find(c => c.label === label);
    if (found) { setSelectedCase(found); resetFlow(); }
  }

  function resetFlow() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStep(0);
    setResult(null);
    setError('');
    setDismissed(new Set());
  }

  async function handleStart() {
    if (!selectedCase) return;
    resetFlow();

    // Step 1 — instant
    setStep(1);

    // Step 2 — 500ms delay (simulate categorization service)
    timerRef.current = setTimeout(async () => {
      setStep(2);

      // Step 3 — actual API call after a brief visual pause
      timerRef.current = setTimeout(async () => {
        setStep(3);
        try {
          const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/booking-check`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              client_id:      clientId,
              invoice_id:     selectedCase.invoice_id     || undefined,
              transaction_id: selectedCase.transaction_id || undefined,
              entry_id:       selectedCase.entry_id       || undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.message || 'Error retrieving check results.');
          } else {
            setResult(data);
          }
        } catch {
          setError('Connection error. Is the server running?');
        }
        setStep(4);
      }, 400);
    }, 500);
  }

  const cases = INVOICE_TEST_CASES[clientId] ?? [];
  const d     = selectedCase?.display ?? {};

  // Split LLM explanation into per-finding chunks (the LLM might output one block per finding
  // or one combined text; we show the full text under the first finding if not parseable)
  const explanationChunks = splitExplanation(result?.explanation ?? '', result?.findings?.length ?? 0);

  return (
    <div className="booking-layout">
      {/* Sidebar */}
      <div className="booking-sidebar">
        <div className="card">
          <div>
            <div className="widget-title">Booking Check</div>
            <div className="widget-subtitle">Real-time quality check when creating a booking</div>
          </div>

          <div className="form-group">
            <label className="form-label">Client</label>
            <select
              className="form-select"
              value={clientId}
              onChange={e => selectClient(e.target.value)}
              disabled={step === 3}
            >
              {CLIENTS.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Invoice / Entry</label>
            <select
              className="form-select"
              value={selectedCase?.label ?? ''}
              onChange={e => selectCase(e.target.value)}
              disabled={step === 3}
            >
              {cases.map(c => (
                <option key={c.invoice_id} value={c.label}>
                  {c.expectError ? '⚠ ' : '✓ '}{c.label}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-primary btn-full"
            onClick={handleStart}
            disabled={step === 3 || !selectedCase}
          >
            {step === 3 ? '⏳ Checking…' : step === 0 ? '▶ Check Entry' : '🔄 Check Again'}
          </button>
        </div>

        {selectedCase && step === 0 && (
          <div className="card" style={{ padding: '14px 16px', fontSize: 13, color: 'var(--color-muted)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Test Case</div>
            <div>{selectedCase.invoice_id}</div>
            {selectedCase.entry_id && <div>{selectedCase.entry_id}</div>}
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                background: selectedCase.expectError ? 'var(--color-error-bg)' : 'var(--color-ok-bg)',
                color: selectedCase.expectError ? 'var(--color-error)' : 'var(--color-ok)',
                border: `1px solid ${selectedCase.expectError ? 'var(--color-error-br)' : 'var(--color-ok-br)'}`,
              }}>
                {selectedCase.expectError ? 'Expected: Finding' : 'Expected: OK'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main flow card */}
      <div className="card booking-flow-card">
        {step === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-title">Select Entry</div>
            <div className="empty-subtitle">
              Select a client and an invoice — then click "Check Entry".
            </div>
          </div>
        ) : (
          <>
            <StepIndicator step={step} />
            <div className="booking-body">

              {/* Step 1: Invoice recognized */}
              {step >= 1 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--color-muted)', marginBottom: 10 }}>
                    ① Invoice Recognized
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{d.counterparty}</div>
                  <div className="booking-invoice-grid">
                    <div className="booking-invoice-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div className="booking-invoice-label">Amount</div>
                      <div className="booking-invoice-value">{d.amount}</div>
                    </div>
                    <div className="booking-invoice-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div className="booking-invoice-label">VAT Rate</div>
                      <div className="booking-invoice-value">{d.vat_rate}</div>
                    </div>
                    <div className="booking-invoice-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div className="booking-invoice-label">Origin</div>
                      <div className="booking-invoice-value">{d.country}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>Type: {d.type}</div>
                </div>
              )}

              {/* Step 2: Category determined */}
              {step >= 2 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--color-muted)', marginBottom: 10 }}>
                    ② Category Set
                  </div>
                  <div className="booking-category-chip">
                    <span className="skr-code">SKR04 {d.account_code}</span>
                    {d.account_name}
                  </div>
                </div>
              )}

              {/* Step 3: Checking spinner */}
              {step === 3 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--color-muted)', marginBottom: 10 }}>
                    ③ Booking Check
                  </div>
                  <div className="booking-check-row">
                    <div className="booking-mini-spinner" />
                    Checking booking…
                  </div>
                </div>
              )}

              {/* Step 4: Result */}
              {step === 4 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--color-muted)', marginBottom: 10 }}>
                    ③ Booking Check
                  </div>

                  {error && (
                    <div className="error-message">❌ {error}</div>
                  )}

                  {!error && result?.status === 'ok' && (
                    <div className="booking-clean">
                      <span style={{ fontSize: 20 }}>✅</span>
                      All correct — no issues found.
                    </div>
                  )}

                  {!error && result?.status === 'issues_found' && (
                    <div>
                      {result.findings.map((f, idx) => (
                        <FindingBlock
                          key={f.check_id + idx}
                          finding={f}
                          explanation={explanationChunks[idx] ?? (idx === 0 ? result.explanation : '')}
                          dismissed={dismissed.has(idx)}
                          onDismiss={() => setDismissed(prev => new Set([...prev, idx]))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split LLM explanation text into per-finding chunks.
// If the model outputs multiple blocks separated by blank lines, split there.
// Otherwise return the full text for the first finding.
// ---------------------------------------------------------------------------
function splitExplanation(text, findingCount) {
  if (!text || findingCount <= 1) return [text];
  // Try to split on double-newline blocks
  const chunks = text.split(/\n{2,}(?=\*\*Was ist falsch)/);
  if (chunks.length >= findingCount) return chunks;
  return [text];
}
