import React, { useEffect, useState } from 'react';
import { api, session } from '../lib.js';
import Avatar from './Avatar.jsx';

const CURRENCIES = ['₹', '$', '€', '£'];
const TABS = [['play', 'Play'], ['tables', 'Your tables'], ['standings', 'Standings']];

export default function Lobby({ user, onOpen, onRenamed }) {
  const [tab, setTab] = useState('play');
  const [form, setForm] = useState({
    name: `${user.name}'s table`,
    smallBlind: 5,
    bigBlind: 10,
    defaultBuyIn: 1000,
    tokenValue: 1,
    currency: '₹',
    turnSeconds: 30,
    autoApproveBuyIns: false,
    variant: 'nlhe',
  });
  const [more, setMore] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(user.name);
  const [filter, setFilter] = useState('all');

  const rename = async (e) => {
    e.preventDefault();
    try {
      const { token, user: next } = await api('/api/auth/rename', { name: newName });
      session.save(token, next);
      onRenamed(next);
      setRenaming(false);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    api('/api/me/history').then(setHistory).catch(() => setHistory({ tables: [], standings: [] }));
  }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { name, ...rest } = form;
      const settings = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' && k !== 'currency' && k !== 'variant' ? Number(v) : v]));
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
  const tables = history?.tables ?? [];
  const open = tables.filter((t) => t.status !== 'ended');
  const shown = filter === 'open' ? open : filter === 'ended' ? tables.filter((t) => t.status === 'ended') : tables;

  return (
    <div className="lobby-page">
      <header className="lobby-nav">
        <span className="wordmark small">Poker Hut</span>
        <nav className="lobby-tabs" aria-label="Sections">
          {TABS.map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setError(null); }}>
              {label}
              {id === 'tables' && open.length > 0 && <span className="nav-count">{open.length}</span>}
            </button>
          ))}
        </nav>
        {renaming ? (
          <form className="who" onSubmit={rename}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={24} aria-label="Your name" autoFocus />
            <button className="btn primary sm" disabled={!newName.trim()}>Save</button>
            <button type="button" className="btn ghost sm" onClick={() => { setRenaming(false); setNewName(user.name); }}>Cancel</button>
          </form>
        ) : (
          <button className="who who-btn" onClick={() => setRenaming(true)} title="Change your name">
            <Avatar name={user.name} src={user.avatar} size={30} />
            <span className="who-name">{user.name}</span>
            <span className="muted small">Edit</span>
          </button>
        )}
      </header>

      <main className="lobby">
        {error && <p className="error banner" role="alert">{error}</p>}

        {tab === 'play' && (
          <>
            {open.length > 0 && (
              <section className="rejoin" aria-label="Open tables">
                <span className="rejoin-label">Back to your table</span>
                {open.slice(0, 4).map((t) => (
                  <button key={t.code} className="rejoin-chip" onClick={() => onOpen(t.code)}>
                    <span className="live-dot" aria-hidden="true" />
                    <strong>{t.name}</strong>
                    <span className="muted">{t.code}</span>
                  </button>
                ))}
              </section>
            )}

            <div className="play-grid">
              <form className="panel join-panel" onSubmit={join}>
                <div className="panel-head">
                  <span className="step">1</span>
                  <div><h2>Join a table</h2><p className="muted">Got a code or link from the host? Enter it here.</p></div>
                </div>
                <input className="code-input" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={7} placeholder="K7QX2M" aria-label="Table code" autoCapitalize="characters" />
                <button className="btn primary wide" disabled={joinCode.replace(/[^A-Za-z0-9]/g, '').length !== 6}>Join table</button>
              </form>

              <form className="panel host-panel" onSubmit={create}>
                <div className="panel-head">
                  <span className="step">2</span>
                  <div><h2>Host a table</h2><p className="muted">You approve buy-ins and keep the bill sheet. You can play too.</p></div>
                </div>

                <label className="field">
                  <span>Table name</span>
                  <input value={form.name} onChange={set('name')} maxLength={40} />
                </label>

                <div className="field"><span>Game</span>
                  <div className="seg wide" role="radiogroup" aria-label="Game">
                    {[['nlhe', "No-limit Hold'em"], ['shortdeck', 'Short deck (6+)']].map(([v, l]) => (
                      <button type="button" key={v} role="radio" aria-checked={form.variant === v} className={form.variant === v ? 'on' : ''} onClick={() => setForm({ ...form, variant: v })}>{l}</button>
                    ))}
                  </div>
                </div>

                <div className="field-row">
                  <label className="field"><span>Small blind</span><input type="number" min="1" value={form.smallBlind} onChange={set('smallBlind')} /></label>
                  <label className="field"><span>Big blind</span><input type="number" min="2" value={form.bigBlind} onChange={set('bigBlind')} /></label>
                  <label className="field"><span>Usual buy-in</span><input type="number" min="1" value={form.defaultBuyIn} onChange={set('defaultBuyIn')} /></label>
                </div>

                <button type="button" className="more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
                  <span>{more ? 'Fewer options' : 'More options'}</span>
                  <span className="muted small">Chip value {form.currency}{form.tokenValue} · {Number(form.turnSeconds) ? `${form.turnSeconds}s to act` : 'no timer'} · {form.autoApproveBuyIns ? 'auto-approve' : 'you approve buy-ins'}</span>
                </button>
                {more && (
                  <div className="more-box">
                    <div className="field"><span>What one chip is worth</span>
                      <div className="row">
                        <select value={form.currency} onChange={set('currency')} aria-label="Currency">
                          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <input type="number" min="0.01" step="0.01" value={form.tokenValue} onChange={set('tokenValue')} aria-label="Value of one chip" />
                      </div>
                      <p className="muted small">A {Number(form.defaultBuyIn).toLocaleString('en-IN')}-chip buy-in costs {form.currency}{(perChip * Number(form.defaultBuyIn)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}.</p>
                    </div>
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
                )}

                <button className="btn primary wide" disabled={busy}>{busy ? 'Opening table…' : 'Open table'}</button>
              </form>
            </div>
          </>
        )}

        {tab === 'tables' && (
          <section className="panel">
            <div className="panel-top">
              <h2>Your tables</h2>
              <div className="seg" role="tablist" aria-label="Filter tables">
                {[['all', 'All'], ['open', 'Open'], ['ended', 'Ended']].map(([v, l]) => (
                  <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>
                ))}
              </div>
            </div>
            {!history && <p className="muted">Loading…</p>}
            {history && shown.length === 0 && <p className="muted">{filter === 'all' ? 'Tables you join or host show up here.' : 'Nothing here yet.'}</p>}
            {shown.length > 0 && (
              <ul className="my-tables">
                {shown.map((t) => (
                  <li key={t.code}>
                    <button className="table-row" onClick={() => onOpen(t.code)}>
                      <span className="tr-main">
                        <strong>{t.name}</strong>
                        <span className="muted small">
                          {t.code} · {new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                          {t.is_host ? ' · you hosted' : ''}
                          {t.hands ? ` · ${t.hands} hands` : ''}
                        </span>
                      </span>
                      {t.status === 'ended' && t.net_money !== null
                        ? <span className={`tr-net ${t.net_money > 0 ? 'up' : t.net_money < 0 ? 'down' : ''}`}>{signed(t.net_money, t.currency)}</span>
                        : <span className={`tr-status ${t.status}`}>{t.status === 'ended' ? 'Ended' : 'Open'}</span>}
                      <span className="tr-go" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'standings' && (
          <section className="panel">
            <div className="panel-top">
              <h2>Standings</h2>
              <p className="muted small">Totals from finished sessions you played in.</p>
            </div>
            {!history && <p className="muted">Loading…</p>}
            {history && history.standings.length === 0 && <p className="muted">When a host ends a session, everyone's result lands here.</p>}
            {history && history.standings.length > 0 && (
              <ol className="standings">
                {history.standings.map((r, i) => (
                  <li key={r.user_id + r.currency} className={r.user_id === user.id ? 'mine' : ''}>
                    <span className="st-rank">{i + 1}</span>
                    <Avatar name={r.name} src={r.avatar} size={28} />
                    <span className="st-name">{r.user_id === user.id ? 'You' : r.name}</span>
                    <span className="muted small">{r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}</span>
                    <span className={`tr-net ${r.net_money > 0 ? 'up' : r.net_money < 0 ? 'down' : ''}`}>{signed(r.net_money, r.currency)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function signed(v, currency) {
  const abs = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${currency}${abs}`;
}
