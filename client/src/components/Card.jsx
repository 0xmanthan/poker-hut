import React from 'react';
import Suit from './Suit.jsx';
import { rankLabel, suitOf, isRed, cardName } from '../lib.js';

// A playing card with a real 3D flip. `card` null = face down.
// `flip` plays the turn-over animation on mount (after `delay` ms).
// The face is a big corner index plus one large suit: readable at any size.
// Everything else (fonts, frame, back, colours) comes from the theme.
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
        <div className={`card-face card-front ${faceUp && isRed(card) ? 'red' : 'black'}`}>
          {faceUp && (
            <>
              <span className="idx">
                <span className={`rank ${rankLabel(card) === '10' ? 'ten' : ''}`}>{rankLabel(card)}</span>
                <Suit suit={suitOf(card)} className="idx-suit" />
              </span>
              <span className="art"><Suit suit={suitOf(card)} /></span>
            </>
          )}
        </div>
        <div className="card-face card-back" />
      </div>
    </div>
  );
}
