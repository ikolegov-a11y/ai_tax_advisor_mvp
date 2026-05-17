import FindingCard from './FindingCard.jsx';
import SteuerreserveCard from './SteuerreserveCard.jsx';

export default function ReportView({ report, rawText }) {
  if (!report && !rawText) return null;

  const errors   = report?.errors   ?? [];
  const warnings = report?.warnings ?? [];
  const oks      = report?.ok_checks ?? [];

  const germanSummary = rawText?.split('```').at(-1)?.trim();

  return (
    <div>
      {/* Summary bar */}
      <div className="summary-bar">
        {errors.length > 0 && (
          <span className="summary-chip chip-error">
            ✗ {errors.length} {errors.length === 1 ? 'Fehler' : 'Fehler'}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="summary-chip chip-warning">
            ⚠ {warnings.length} {warnings.length === 1 ? 'Hinweis' : 'Hinweise'}
          </span>
        )}
        {oks.length > 0 && (
          <span className="summary-chip chip-ok">
            ✓ {oks.length} geprüft
          </span>
        )}
      </div>

      {/* Steuerreserve */}
      {report?.steuerreserve && (
        <SteuerreserveCard data={report.steuerreserve} />
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="section">
          <div className="section-header error-color">
            <span className="section-count">{errors.length}</span>
            Fehler — sofort handeln
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
            Hinweise — prüfen empfohlen
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
            Korrekt
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

      {/* German summary */}
      {germanSummary && report && (
        <div className="summary-de">
          <span className="summary-de-label">KI-Zusammenfassung</span>
          {germanSummary}
        </div>
      )}
    </div>
  );
}
