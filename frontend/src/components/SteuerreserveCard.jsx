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
        💰 Tax Reserve
      </div>

      <div className="reserve-highlight">{fmt(data.recommended_monthly_saving)}</div>
      <div className="reserve-highlight-label">recommended monthly savings</div>

      <div className="reserve-grid">
        <div className="reserve-item">
          <span className="reserve-item-label">Estimated annual income</span>
          <span className="reserve-item-value">{fmt(data.estimated_annual_income)}</span>
        </div>
        <div className="reserve-item">
          <span className="reserve-item-label">Estimated annual tax</span>
          <span className="reserve-item-value">{fmt(data.estimated_annual_tax)}</span>
        </div>
        <div className="reserve-item">
          <span className="reserve-item-label">Recommended monthly saving</span>
          <span className="reserve-item-value">{fmt(data.recommended_monthly_saving)}</span>
        </div>
      </div>

      {data.kleinunternehmer_threshold_warning && (
        <div className="reserve-warning">
          ⚠️ Notice: Your revenue is approaching the small business threshold (€22,000).
          Review your VAT status for the coming year.
        </div>
      )}

      {data.notes && (
        <div className="reserve-notes">{data.notes}</div>
      )}
    </div>
  );
}
