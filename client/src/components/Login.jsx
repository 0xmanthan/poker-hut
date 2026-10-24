import React, { useEffect, useRef, useState } from 'react';
import { api, session } from '../lib.js';
import Card from './Card.jsx';

// A♠ K♠ Q♠ J♠ 10♠
const HERO = [51, 47, 43, 39, 35];

function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    document.head.appendChild(s);
  });
}

export default function Login({ onSignedIn, joining }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const btnRef = useRef(null);

  useEffect(() => {
    api('/api/config').then(setConfig).catch(() => setError('Could not reach the server. Refresh to try again.'));
  }, []);

  useEffect(() => {
    if (!config?.googleClientId) return;
    loadGoogle().then(() => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async ({ credential }) => {
          try {
            setBusy(true);
            const { token, user } = await api('/api/auth/google', { credential });
            session.save(token, user);
            onSignedIn(user);
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        },
      });
      if (btnRef.current) {
        window.google.accounts.id.renderButton(btnRef.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
      }
    }).catch((e) => setError(e.message));
  }, [config, onSignedIn]);

  const guest = async (e) => {
    e.preventDefault();
    setBusy(true);
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
        {joining && <p className="joining">Sign in to join table <strong>{joining}</strong>.</p>}
        <div className="signin">
          {config?.googleClientId && <div ref={btnRef} className="google-btn" />}
          {config && !config.googleClientId && !config.allowGuest && (
            <p className="hint">Sign-in isn't set up on this server yet. Add a Google client ID (see README).</p>
          )}
          {config?.allowGuest && (
            <form onSubmit={guest} className="guest">
              <label htmlFor="guest-name">{config.googleClientId ? 'Or play with just a name' : 'Your name at the table'}</label>
              <div className="row">
                <input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Manthan" autoComplete="nickname" />
                <button className="btn primary" disabled={busy || !name.trim()}>Sit in</button>
              </div>
            </form>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </section>
    </main>
  );
}
