import { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ReportView from '../components/ReportView.jsx';

const PERIOD_OPTIONS = [
  { value: '',         label: 'Gesamtes Jahr' },
  { value: 'Q1 2026',  label: 'Q1 2026 (Jan–Mär)' },
  { value: 'Q2 2026',  label: 'Q2 2026 (Apr–Jun)' },
  { value: 'Q3 2026',  label: 'Q3 2026 (Jul–Sep)' },
  { value: 'Q4 2026',  label: 'Q4 2026 (Okt–Dez)' },
  { value: 'Q1 2025',  label: 'Q1 2025 (Jan–Mär)' },
  { value: 'Q2 2025',  label: 'Q2 2025 (Apr–Jun)' },
  { value: 'Q3 2025',  label: 'Q3 2025 (Jul–Sep)' },
  { value: 'Q4 2025',  label: 'Q4 2025 (Okt–Dez)' },
];

export default function WidgetVariant() {
  const [clients, setClients]   = useState([]);
  const [clientId, setClientId] = useState('');
  const [period, setPeriod]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [report, setReport]     = useState(null);
  const [rawText, setRawText]   = useState('');
  const [error, setError]       = useState('');
  const [threadId, setThreadId] = useState(null);

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.json())
      .then(data => {
        setClients(data);
        if (data.length > 0) setClientId(data[0].id);
      })
      .catch(() => setError('Clients konnten nicht geladen werden.'));
  }, []);

  async function handleAnalyze() {
    if (!clientId) return;
    setLoading(true);
    setReport(null);
    setRawText('');
    setError('');

    const userQuery = `Bitte analysiere alle Buchungen${period ? ` für ${period}` : ''} und identifiziere alle Fehler, Risiken und Warnungen. Prüfe alle verfügbaren Blöcke (A, B, C, E) und berechne die Steuerreserve.`;

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, period: period || undefined, userQuery, threadId })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Analyse fehlgeschlagen.');
        return;
      }

      setThreadId(data.threadId);
      setReport(data.report);
      setRawText(data.raw_text ?? '');
    } catch {
      setError('Verbindungsfehler. Ist der Server gestartet?');
    } finally {
      setLoading(false);
    }
  }

  const selectedClient = clients.find(c => c.id === clientId);

  return (
    <div className="widget-layout">
      {/* Sidebar */}
      <div className="widget-sidebar">
        <div className="card">
          <div>
            <div className="widget-title">Buchführungsprüfung</div>
            <div className="widget-subtitle">KI analysiert Ihre Buchhaltung auf Fehler und Risiken</div>
          </div>

          <div className="form-group">
            <label className="form-label">Mandant</label>
            <select
              className="form-select"
              value={clientId}
              onChange={e => { setClientId(e.target.value); setReport(null); setThreadId(null); }}
              disabled={loading}
            >
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Zeitraum</label>
            <select
              className="form-select"
              value={period}
              onChange={e => setPeriod(e.target.value)}
              disabled={loading}
            >
              {PERIOD_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-primary btn-full"
            onClick={handleAnalyze}
            disabled={loading || !clientId}
          >
            {loading ? '⏳ Wird analysiert…' : '🔍 Bücher prüfen'}
          </button>

          {report && !loading && (
            <button
              className="btn btn-full"
              style={{ background: '#f4f5f9', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              onClick={handleAnalyze}
            >
              🔄 Erneut prüfen
            </button>
          )}
        </div>

        {selectedClient && !loading && (
          <div className="card" style={{ padding: '14px 16px', fontSize: 13, color: 'var(--color-muted)' }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
              {selectedClient.display_name}
            </div>
            <div>ID: {selectedClient.id}</div>
            {threadId && (
              <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                Thread: {threadId.slice(0, 8)}…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="widget-content">
        <div className="card">
          {loading && <LoadingSpinner />}

          {!loading && !report && !error && (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-title">Bereit zur Analyse</div>
              <div className="empty-subtitle">
                Wählen Sie einen Mandanten und einen Zeitraum, dann klicken Sie auf „Bücher prüfen".
              </div>
            </div>
          )}

          {!loading && error && (
            <div style={{ padding: 24 }}>
              <div className="error-message">❌ {error}</div>
            </div>
          )}

          {!loading && (report || rawText) && (
            <div style={{ padding: 24 }}>
              <ReportView report={report} rawText={rawText} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
