function fmt(n) {
  return typeof n === 'number'
    ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    : '—';
}

export default function SteuerreserveCard({ data }) {
  if (!data) return null;

  return (
    <div className="reserve-card">
      <div className="reserve-header">
        💰 Steuerreserve
      </div>

      <div className="reserve-highlight">{fmt(data.recommended_monthly_saving)}</div>
      <div className="reserve-highlight-label">empfohlene monatliche Rücklage</div>

      <div className="reserve-grid">
        <div className="reserve-item">
          <span className="reserve-item-label">Geschätztes Jahreseinkommen</span>
          <span className="reserve-item-value">{fmt(data.estimated_annual_income)}</span>
        </div>
        <div className="reserve-item">
          <span className="reserve-item-label">Geschätzte Jahressteuer</span>
          <span className="reserve-item-value">{fmt(data.estimated_annual_tax)}</span>
        </div>
        <div className="reserve-item">
          <span className="reserve-item-label">Bereits zurückgelegt</span>
          <span className="reserve-item-value">{fmt(data.already_reserved)}</span>
        </div>
        <div className="reserve-item">
          <span className="reserve-item-label">Fehlbetrag</span>
          <span className="reserve-item-value">
            {fmt(Math.max(0, (data.estimated_annual_tax || 0) - (data.already_reserved || 0)))}
          </span>
        </div>
      </div>

      {data.kleinunternehmer_threshold_warning && (
        <div className="reserve-warning">
          ⚠️ Achtung: Ihr Umsatz nähert sich der Kleinunternehmergrenze (22.000 €).
          Prüfen Sie Ihren Umsatzsteuerstatus für das kommende Jahr.
        </div>
      )}

      {data.notes && (
        <div className="reserve-notes">{data.notes}</div>
      )}
    </div>
  );
}
