import React, { useState } from 'react';
import { api } from '../lib.js';
import Avatar from './Avatar.jsx';

const CURRENCIES = ['₹', '$', '€', '£'];

export default function Lobby({ user, onOpen, onSignOut }) {
  const [form, setForm] = useState({
    name: `${user.name}'s table`,
    smallBlind: 5,
    bigBlind: 10,
    defaultBuyIn: 1000,
    tokenValue: 1,
    currency: '₹',
    turnSeconds: 30,
    autoApproveBuyIns: false,
  });
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { name, ...rest } = form;
      const settings = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' && k !== 'currency' ? Number(v) : v]));
      if (!(settings.bigBlind > 0 && settings.smallBlind > 0 && settings.smallBlind <= settings.bigBlind)) throw new Error('Small blind must be at most the big blind.');
      if (!(settings.tokenValue > 0)) throw new Error('Chip value must be more than zero.');
      const { code } = await api('/api/tables', { name, settings });
      onOpen(code);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const join = (e) => {
    e.preventDefault();
    const code = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length === 6) onOpen(code);
    else setError('Table codes are 6 characters, like K7QX2M.');
  };

  const perChip = Number(form.tokenValue) || 0;

  return (
    <main className="lobby">
      <header className="lobby-top">
        <span className="wordmark small">Poker Hut</span>
        <div className="who">
          <Avatar name={user.name} src={user.avatar} size={32} />
          <span>{user.name}</span>
          <button className="btn ghost sm" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div className="lobby-grid">
        <form className="panel join-panel" onSubmit={join}>
          <h2>Join a table</h2>
          <p className="muted">Ask the host for the code or the link.</p>
          <div className="row">
            <input className="code-input" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={7} placeholder="K7QX2M" aria-label="Table code" autoCapitalize="characters" />
            <button className="btn primary">Join</button>
          </div>
        </form>

        <form className="panel host-panel" onSubmit={create}>
          <h2>Host a table</h2>
          <p className="muted">You'll approve buy-ins and keep the bill sheet. You can play too.</p>

          <label className="field">
            <span>Table name</span>
            <input value={form.name} onChange={set('name')} maxLength={40} />
          </label>

          <div className="field-row">
            <label className="field"><span>Small blind</span><input type="number" min="1" value={form.smallBlind} onChange={set('smallBlind')} /></label>
            <label className="field"><span>Big blind</span><input type="number" min="2" value={form.bigBlind} onChange={set('bigBlind')} /></label>
            <label className="field"><span>Usual buy-in</span><input type="number" min="1" value={form.defaultBuyIn} onChange={set('defaultBuyIn')} /></label>
          </div>

          <fieldset className="chip-value">
            <legend>What one chip is worth</legend>
            <div className="row">
              <select value={form.currency} onChange={set('currency')} aria-label="Currency">
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <input type="number" min="0.01" step="0.01" value={form.tokenValue} onChange={set('tokenValue')} aria-label="Value of one chip" />
              <span className="muted">per chip</span>
            </div>
            <p className="muted small">A {Number(form.defaultBuyIn).toLocaleString('en-IN')}-chip buy-in costs {form.currency}{(perChip * Number(form.defaultBuyIn)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}.</p>
          </fieldset>

          <div className="field-row">
            <label className="field">
              <span>Time to act</span>
              <select value={form.turnSeconds} onChange={set('turnSeconds')}>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
                <option value={45}>45 seconds</option>
                <option value={60}>1 minute</option>
                <option value={0}>No limit</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={form.autoApproveBuyIns} onChange={set('autoApproveBuyIns')} />
              <span>Approve buy-ins automatically</span>
            </label>
          </div>

          <button className="btn primary wide" disabled={busy}>{busy ? 'Opening table…' : 'Open table'}</button>
        </form>
      </div>
      {error && <p className="error center" role="alert">{error}</p>}
    </main>
  );
}
