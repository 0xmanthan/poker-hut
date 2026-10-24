import React, { useState } from 'react';
import { api, session } from '../lib.js';
import Card from './Card.jsx';

// A♠ K♠ Q♠ J♠ 10♠
const HERO = [51, 47, 43, 39, 35];

// No accounts: you pick a name and this browser remembers you.
export default function Login({ onSignedIn, joining }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const enter = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api('/api/auth/guest', { name });
      session.save(token, user);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <div className="login-felt" aria-hidden="true">
        <div className="hero-fan">
          {HERO.map((c, i) => (
            <div key={c} className="fan-slot" style={{ '--i': i - 2 }}>
              <Card card={c} size="xl" flip delay={350 + i * 140} />
            </div>
          ))}
        </div>
      </div>
      <section className="login-panel">
        <h1 className="wordmark">Poker Hut</h1>
        <p className="lede">Your home game, dealt straight. One real deck, shuffled fresh every hand, with the bill sheet kept for you.</p>
        {joining && <p className="joining">Enter your name to join table <strong>{joining}</strong>.</p>}
        <form onSubmit={enter} className="guest signin">
          <label htmlFor="guest-name">Your name at the table</label>
          <div className="row">
            <input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Manthan" autoComplete="nickname" autoFocus />
            <button className="btn primary" disabled={busy || !name.trim()}>{joining ? 'Join table' : 'Sit in'}</button>
          </div>
          <p className="hint small">This browser remembers you, so use the same one all night. Your chips stay with you if you reload.</p>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>
    </main>
  );
}
