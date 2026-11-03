import React, { useEffect, useRef } from 'react';
import { chips, money } from '../lib.js';

// Pick how many chips to bring: big −/+ steppers around the amount, plus one-tap
// amounts based on the table's usual buy-in.
export function BuyInPicker({ value, onChange, settings, autoFocus }) {
  const input = useRef(null);
  // focus without scrolling the table under the popover
  useEffect(() => { if (autoFocus) input.current?.focus({ preventScroll: true }); }, [autoFocus]);
  const base = settings.defaultBuyIn;
  const step = Math.max(settings.bigBlind, Math.round(base / 10));
  const n = Math.floor(Number(value)) || 0;
  const quick = [0.5, 1, 2].map((k) => Math.max(settings.bigBlind, Math.round(base * k)));
  const bump = (d) => onChange(String(Math.max(step, n + d)));
  return (
    <div className="buy-pick">
      <div className="buy-amount">
        <button type="button" className="round-btn" onClick={() => bump(-step)} disabled={n <= step} aria-label={`${chips(step)} fewer chips`}>−</button>
        <label className="amount-box">
          <input
            ref={input} type="text" inputMode="numeric" autoComplete="off" value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
            onFocus={(e) => e.target.select()}
            aria-label="Chips to bring"
          />
          <span>chips</span>
        </label>
        <button type="button" className="round-btn" onClick={() => bump(step)} aria-label={`${chips(step)} more chips`}>+</button>
      </div>
      <div className="buy-quick" role="group" aria-label="Quick amounts">
        {quick.map((v, i) => (
          <button type="button" key={i} className={`quick-opt ${n === v ? 'on' : ''}`} onClick={() => onChange(String(v))}>
            {chips(v)}{v === base && <small>usual</small>}
          </button>
        ))}
      </div>
      {settings.tokenValue !== 1 && n > 0 && <p className="buy-money">Costs {money(n, settings)}</p>}
    </div>
  );
}
