import FindingCard from './FindingCard.jsx';
import SteuerreserveCard from './SteuerreserveCard.jsx';

export default function ReportView({ report, rawText }) {
  if (!report && !rawText) return null;

  const errors   = report?.errors   ?? [];
  const warnings = report?.warnings ?? [];
  const oks      = report?.ok_checks ?? [];

  const aiSummary = rawText?.split('```').at(-1)?.trim();

  return (
    <div>
      {/* Summary bar */}
      <div className="summary-bar">
        {errors.length > 0 && (
          <span className="summary-chip chip-error">
            ✗ {errors.length} {errors.length === 1 ? 'Error' : 'Errors'}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="summary-chip chip-warning">
            ⚠ {warnings.length} {warnings.length === 1 ? 'Warning' : 'Warnings'}
          </span>
        )}
        {oks.length > 0 && (
          <span className="summary-chip chip-ok">
            ✓ {oks.length} checked
          </span>
        )}
      </div>

      {/* Tax Reserve */}
      {report?.steuerreserve && (
        <SteuerreserveCard data={report.steuerreserve} />
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="section">
          <div className="section-header error-color">
            <span className="section-count">{errors.length}</span>
            Errors — action required
          </div>
          {errors.map(f => (
            <FindingCard key={f.id} finding={f} type="error" />
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="section">
          <div className="section-header warning-color">
            <span className="section-count">{warnings.length}</span>
            Warnings — review recommended
          </div>
          {warnings.map(f => (
            <FindingCard key={f.id} finding={f} type="warning" />
          ))}
        </div>
      )}

      {/* OK checks */}
      {oks.length > 0 && (
        <div className="section">
          <div className="section-header ok-color">
            <span className="section-count">{oks.length}</span>
            Correct
          </div>
          <div className="ok-list">
            {oks.map(f => (
              <FindingCard key={f.id} finding={f} type="ok" />
            ))}
          </div>
        </div>
      )}

      {/* Raw report fallback */}
      {!report && rawText && (
        <div className="error-message" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
          {rawText}
        </div>
      )}

      {/* AI summary */}
      {aiSummary && report && (
        <div className="summary-de">
          <span className="summary-de-label">AI Summary</span>
          {aiSummary}
        </div>
      )}
    </div>
  );
}
