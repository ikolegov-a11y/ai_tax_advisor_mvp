import { useState, useEffect } from 'react';
import WidgetVariant   from './variants/WidgetVariant.jsx';
import ChatVariant     from './variants/ChatVariant.jsx';
import BookingVariant  from './variants/BookingVariant.jsx';

const VALID_VARIANTS = ['widget', 'chat', 'booking'];

function getVariant() {
  const p = new URLSearchParams(window.location.search);
  const v = p.get('variant');
  return VALID_VARIANTS.includes(v) ? v : 'widget';
}

function setVariantInUrl(v) {
  const url = new URL(window.location.href);
  url.searchParams.set('variant', v);
  window.history.pushState({}, '', url);
}

export default function App() {
  const [variant, setVariant] = useState(getVariant);

  function switchVariant(v) {
    setVariant(v);
    setVariantInUrl(v);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header-logo">🧾</span>
        <span className="app-header-brand">AI Tax Advisor</span>
        <span className="app-header-badge">BETA</span>
        <div className="app-header-variant-switch">
          <button
            className={`variant-btn${variant === 'widget' ? ' active' : ''}`}
            onClick={() => switchVariant('widget')}
          >
            Widget
          </button>
          <button
            className={`variant-btn${variant === 'chat' ? ' active' : ''}`}
            onClick={() => switchVariant('chat')}
          >
            Chat
          </button>
          <button
            className={`variant-btn${variant === 'booking' ? ' active' : ''}`}
            onClick={() => switchVariant('booking')}
          >
            Booking
          </button>
        </div>
      </header>

      <main className="app-main">
        {variant === 'widget'  && <WidgetVariant />}
        {variant === 'chat'    && <ChatVariant />}
        {variant === 'booking' && <BookingVariant />}
      </main>
    </div>
  );
}
