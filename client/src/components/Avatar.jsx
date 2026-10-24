import React, { useState } from 'react';

const HUES = [12, 38, 160, 195, 220, 265, 300, 340];

export default function Avatar({ name, src, size = 48 }) {
  const [broken, setBroken] = useState(false);
  const initials = (name ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const hue = HUES[[...(name ?? '')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % HUES.length];
  if (src && !broken) {
    return <img className="avatar" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className="avatar initials" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 32% 34%)` }} aria-hidden="true">
      {initials}
    </span>
  );
}
