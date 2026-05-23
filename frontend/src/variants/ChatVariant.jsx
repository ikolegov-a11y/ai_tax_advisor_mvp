import { useState, useEffect, useRef } from 'react';
import ReportView from '../components/ReportView.jsx';

const PERIOD_OPTIONS = [
  { value: '',         label: 'Full Year' },
  { value: 'Q1 2026',  label: 'Q1 2026' },
  { value: 'Q2 2026',  label: 'Q2 2026' },
  { value: 'Q3 2026',  label: 'Q3 2026' },
  { value: 'Q4 2026',  label: 'Q4 2026' },
  { value: 'Q1 2025',  label: 'Q1 2025' },
  { value: 'Q2 2025',  label: 'Q2 2025' },
];

function TypingIndicator() {
  return (
    <div className="chat-message assistant">
      <div className="chat-avatar">🤖</div>
      <div className="chat-typing">
        <span /><span /><span />
      </div>
    </div>
  );
}

export default function ChatVariant() {
  const [clients, setClients]   = useState([]);
  const [clientId, setClientId] = useState('');
  const [period, setPeriod]     = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [started, setStarted]   = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE || ''}/api/clients`)
      .then(r => r.json())
      .then(data => {
        setClients(data);
        if (data.length > 0) setClientId(data[0].id);
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function addMessage(role, content, report = null, rawText = '') {
    setMessages(prev => [...prev, { role, content, report, rawText, id: Date.now() }]);
  }

  async function startAnalysis() {
    if (!clientId || loading) return;
    setStarted(true);
    setLoading(true);

    const periodLabel = period || 'the full year';
    addMessage('assistant', `I'm reviewing your books for ${periodLabel}… This takes about 2 minutes.`);

    const userQuery = `Please analyze all bookings${period ? ` for ${period}` : ''} proactively. Start with the most critical issue and explain it clearly. Identify all errors, risks and warnings and calculate the tax reserve.`;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, period: period || undefined, userQuery })
      });
      const data = await res.json();

      setThreadId(data.threadId);

      if (!res.ok) {
        addMessage('assistant', `❌ Error: ${data.message || 'Analysis failed.'}`);
        return;
      }

      setMessages(prev => prev.slice(0, -1)); // remove "checking…" message
      addMessage('assistant', null, data.report, data.raw_text);
    } catch {
      addMessage('assistant', '❌ Connection error. Is the backend server running?');
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !started) return;

    setInput('');
    addMessage('user', text);
    setLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, period: period || undefined, userQuery: text, threadId })
      });
      const data = await res.json();

      if (!res.ok) {
        addMessage('assistant', `❌ ${data.message || 'Error'}`);
        return;
      }

      setThreadId(data.threadId);
      if (data.report) {
        addMessage('assistant', null, data.report, data.raw_text);
      } else {
        addMessage('assistant', data.raw_text || 'No response received.');
      }
    } catch {
      addMessage('assistant', '❌ Connection error.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="chat-layout">
      {/* Setup bar */}
      <div className="chat-setup-bar">
        <div className="form-group">
          <label className="form-label">Client</label>
          <select
            className="form-select"
            value={clientId}
            onChange={e => { setClientId(e.target.value); setMessages([]); setThreadId(null); setStarted(false); }}
            disabled={loading || started}
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
            disabled={loading || started}
          >
            {PERIOD_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {!started ? (
          <button
            className="btn btn-primary"
            onClick={startAnalysis}
            disabled={!clientId || loading}
            style={{ flexShrink: 0 }}
          >
            🔍 Start Analysis
          </button>
        ) : (
          <button
            className="btn"
            style={{ flexShrink: 0, background: '#f4f5f9', border: '1px solid var(--color-border)' }}
            onClick={() => { setMessages([]); setThreadId(null); setStarted(false); }}
          >
            🔄 Start Over
          </button>
        )}
      </div>

      {/* Chat window */}
      <div className="chat-window">
        <div className="chat-messages">
          {messages.length === 0 && !loading && (
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-icon">💬</div>
              <div className="empty-title">AI Tax Advisor</div>
              <div className="empty-subtitle">
                Select a client and click "Start Analysis".
                The AI will proactively review your books and explain the key issues.
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`chat-message ${msg.role}`}>
              <div className="chat-avatar">
                {msg.role === 'user' ? 'You' : '🤖'}
              </div>
              {msg.report ? (
                <div className="chat-bubble chat-bubble-report" style={{ flex: 1 }}>
                  <ReportView report={msg.report} rawText={msg.rawText} />
                </div>
              ) : (
                <div className="chat-bubble">{msg.content}</div>
              )}
            </div>
          ))}

          {loading && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-bar">
          <textarea
            className="chat-input"
            rows={1}
            placeholder={started ? 'Ask a question… (e.g. "What exactly is wrong with entry entry_001_009?")' : 'Start the analysis first…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || !started}
          />
          <button
            className="chat-send-btn"
            onClick={sendMessage}
            disabled={loading || !started || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
