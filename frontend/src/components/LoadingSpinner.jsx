import { useState, useEffect } from 'react';

const STEPS = [
  'Lade Kontoauszüge und Rechnungen…',
  'Prüfe Buchungen gegen Belege…',
  'Analysiere USt-Deklarationen…',
  'Berechne Steuerreserve…',
  'Erstelle Abschlussbericht…',
];

export default function LoadingSpinner() {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(5);

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setStep(s => (s < STEPS.length - 1 ? s + 1 : s));
    }, 28000);

    const progressInterval = setInterval(() => {
      setProgress(p => {
        if (p >= 92) return p;
        return p + (92 - p) * 0.03;
      });
    }, 2000);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <div>
        <div className="loading-title">KI analysiert Ihre Buchhaltung…</div>
        <div className="loading-subtitle">Dauert etwa 2 Minuten — bitte warten</div>
      </div>

      <div className="progress-bar-wrap">
        <div className="progress-bar-fill" style={{ width: `${Math.round(progress)}%` }} />
      </div>

      <div className="loading-steps">
        {STEPS.map((label, i) => (
          <div key={i} className={`loading-step${i === step ? ' active' : ''}`}>
            <div className="loading-step-dot" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
