import React, { useEffect, useRef } from 'react';
import { chips, money } from '../lib.js';

// amount box plus one-tap multiples of the table's usual buy-in
export function BuyInPicker({ value, onChange, settings, autoFocus }) {
  const input = useRef(null);
  // focus without scrolling the table under the popover
  useEffect(() => { if (autoFocus) input.current?.focus({ preventScroll: true }); }, [autoFocus]);
  const base = settings.defaultBuyIn;
  const quick = [[0.5, '½×'], [1, '1×'], [2, '2×']].map(([k, l]) => [Math.max(settings.bigBlind, Math.round(base * k)), l]);
  return (
    <div className="buy-pick">
      <div className="buy-quick">
        {quick.map(([v, l]) => (
          <button type="button" key={l} className={`preset ${Number(value) === v ? 'on' : ''}`} onClick={() => onChange(String(v))}>{l} <span>{chips(v)}</span></button>
        ))}
      </div>
      <label className="buy-amount">
        <input type="number" min="1" step="1" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Chips" ref={input} />
        <span className="muted">{money(Number(value) || 0, settings)}</span>
      </label>
    </div>
  );
}
