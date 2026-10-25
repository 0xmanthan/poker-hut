import React from 'react';

// Drawn suits, so every phone and laptop shows the same shapes (unicode glyphs
// vary by font and some platforms swap in emoji). Index matches SUIT_GLYPHS: ♣ ♦ ♥ ♠.
const SHAPES = [
  <g key="c">
    <circle cx="50" cy="27" r="21" />
    <circle cx="26" cy="56" r="21" />
    <circle cx="74" cy="56" r="21" />
    <circle cx="50" cy="50" r="13" />
    <path d="M46 56 C46 75 41 86 30 97 H70 C59 86 54 75 54 56 Z" />
  </g>,
  <path key="d" d="M50 2 C60 18 74 36 90 50 C74 64 60 82 50 98 C40 82 26 64 10 50 C26 36 40 18 50 2 Z" />,
  <path key="h" d="M50 92 C44 84 30 72 17 60 C5 49 2 40 2 30 C2 15 14 5 28 5 C38 5 46 11 50 20 C54 11 62 5 72 5 C86 5 98 15 98 30 C98 40 95 49 83 60 C70 72 56 84 50 92 Z" />,
  <path key="s" d="M50 3 C57 18 76 30 88 43 C99 55 97 75 82 81 C72 85 61 81 55 72 C56 83 61 90 70 97 H30 C39 90 44 83 45 72 C39 81 28 85 18 81 C3 75 1 55 12 43 C24 30 43 18 50 3 Z" />,
];

export default function Suit({ suit, className = '' }) {
  return (
    <svg className={`suit ${className}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <g fill="currentColor">{SHAPES[suit]}</g>
    </svg>
  );
}
