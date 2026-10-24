import React from 'react';
import { rankLabel, suitOf, isRed, SUIT_GLYPHS, cardName } from '../lib.js';

// A playing card with a real 3D flip. `card` null = face down.
// `flip` plays the turn-over animation on mount (after `delay` ms).
export default function Card({ card, size = 'md', flip = false, delay = 0, dim = false, glow = false, from, className = '' }) {
  const faceUp = card !== null && card !== undefined;
  const style = { '--delay': `${delay}ms` };
  if (from) { style['--from-x'] = `${from.x}px`; style['--from-y'] = `${from.y}px`; }
  return (
    <div
      className={`card card-${size} ${faceUp ? 'up' : 'down'} ${flip && faceUp ? 'flip-in' : ''} ${from ? 'fly-in' : ''} ${dim ? 'dim' : ''} ${glow ? 'glow' : ''} ${className}`}
      style={style}
      aria-label={faceUp ? cardName(card) : 'Face-down card'}
      role="img"
    >
      <div className="card-inner">
        <div className="card-face card-front">
          {faceUp && (
            <div className={isRed(card) ? 'red' : 'black'}>
              <span className="corner">
                <span className="rank">{rankLabel(card)}</span>
                <span className="suit">{SUIT_GLYPHS[suitOf(card)]}</span>
              </span>
              <span className="pip">{SUIT_GLYPHS[suitOf(card)]}</span>
            </div>
          )}
        </div>
        <div className="card-face card-back" />
      </div>
    </div>
  );
}
