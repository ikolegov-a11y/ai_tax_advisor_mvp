import { useState, useEffect } from 'react';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import ReportView from '../components/ReportView.jsx';

const PERIOD_OPTIONS = [
  { value: '',         label: 'Full Year' },
  { value: 'Q1 2026',  label: 'Q1 2026 (Jan–Mar)' },
  { value: 'Q2 2026',  label: 'Q2 2026 (Apr–Jun)' },
  { value: 'Q3 2026',  label: 'Q3 2026 (Jul–Sep)' },
  { value: 'Q4 2026',  label: 'Q4 2026 (Oct–Dec)' },
  { value: 'Q1 2025',  label: 'Q1 2025 (Jan–Mar)' },
  { value: 'Q2 2025',  label: 'Q2 2025 (Apr–Jun)' },
  { value: 'Q3 2025',  label: 'Q3 2025 (Jul–Sep)' },
  { value: 'Q4 2025',  label: 'Q4 2025 (Oct–Dec)' },
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
    fetch(`${import.meta.env.VITE_API_BASE || ''}/api/clients`)
      .then(r => r.json())
      .then(data => {
        setClients(data);
        if (data.length > 0) setClientId(data[0].id);
      })
      .catch(() => setError('Could not load clients.'));
  }, []);

  async function handleAnalyze() {
    if (!clientId) return;
    setLoading(true);
    setReport(null);
    setRawText('');
    setError('');

    const userQuery = `Please analyze all bookings${period ? ` for ${period}` : ''} and identify all errors, risks and warnings. Check all available blocks (A, B, C, E) and calculate the tax reserve.`;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, period: period || undefined, userQuery, threadId })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Analysis failed.');
        return;
      }

      setThreadId(data.threadId);
      setReport(data.report);
      setRawText(data.raw_text ?? '');
    } catch {
      setError('Connection error. Is the server running?');
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
            <div className="widget-title">Accounting Review</div>
            <div className="widget-subtitle">AI analyzes your books for errors and risks</div>
          </div>

          <div className="form-group">
            <label className="form-label">Client</label>
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
            <label className="form-label">Period</label>
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
            {loading ? '⏳ Analyzing…' : '🔍 Check Books'}
          </button>

          {report && !loading && (
            <button
              className="btn btn-full"
              style={{ background: '#f4f5f9', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              onClick={handleAnalyze}
            >
              🔄 Run Again
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
              <div className="empty-title">Ready to Analyze</div>
              <div className="empty-subtitle">
                Select a client and a period, then click "Check Books".
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
