import { useState } from 'react';

export default function FindingCard({ finding, type }) {
  const [open, setOpen] = useState(false);
  const isOk = type === 'ok';

  if (isOk) {
    return (
      <div className="ok-item">
        <span className="ok-item-check">✓</span>
        <span className="ok-item-id">{finding.id}</span>
        <span>{finding.title}</span>
      </div>
    );
  }

  return (
    <div className={`finding-card ${type}`}>
      <div className="finding-header" onClick={() => setOpen(o => !o)}>
        <span className="finding-id">{finding.id}</span>
        <span className="finding-title">{finding.title}</span>
        <span className={`finding-chevron${open ? ' open' : ''}`}>▼</span>
      </div>

      {open && (
        <div className="finding-body">
          {finding.description && (
            <p className="finding-description">{finding.description}</p>
          )}

          {finding.affected_items?.length > 0 && (
            <div className="finding-items">
              {finding.affected_items.map(item => (
                <span key={item} className="finding-item-tag">{item}</span>
              ))}
            </div>
          )}

          {finding.recommendation && (
            <div className="finding-recommendation">
              💡 {finding.recommendation}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
