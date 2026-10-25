import React from 'react';
import { chips } from '../lib.js';

// Real denominations, so a stack's colours say roughly how big a bet is.
// Colours per denomination come from the theme (.den-N in styles.css).
const DENOMS = [100000, 25000, 5000, 1000, 500, 100, 25, 5, 1];
const MAX_DISCS = 5;

function discsFor(amount) {
  const out = [];
  let left = Math.max(0, Math.floor(amount));
  for (const d of DENOMS) {
    while (left >= d && out.length < MAX_DISCS) { out.push(d); left -= d; }
    if (out.length >= MAX_DISCS) break;
  }
  return out.length ? out.reverse() : [1]; // smallest on top, largest at the bottom
}

export function ChipStack({ amount, size }) {
  const discs = discsFor(amount);
  return (
    <span className="chipstack" style={size ? { '--c': size } : undefined} aria-hidden="true">
      {discs.map((d, i) => <span key={i} className={`disc den-${d}`} style={{ '--n': discs.length - 1 - i }} />)}
    </span>
  );
}

// A stack with its amount beside it: bets on the felt and the pot.
export default function Chips({ amount, className = '', label, style }) {
  return (
    <div className={`chips ${className}`} style={style}>
      <ChipStack amount={amount} />
      <span className="chips-amt">{label && <em>{label}</em>}{chips(amount)}</span>
    </div>
  );
}
