import React, { useEffect, useRef, useState } from 'react';
import { useTable } from '../useTable.js';
import { chips, money, sound, witness } from '../lib.js';
import PokerTable from './PokerTable.jsx';
import ActionBar from './ActionBar.jsx';
import SidePanel from './SidePanel.jsx';
import Icon from './Icons.jsx';
import { THEMES, useTheme } from '../theme.js';

function usePortrait() {
  const q = '(max-aspect-ratio: 4/5)';
  const [p, setP] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setP(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return p;
}

export default function TableScreen({ code, user, onLeave }) {
  const { state, chat, status, toast, setToast, send, serverNow, history } = useTable(code);
  const portrait = usePortrait();
  const [panel, setPanel] = useState(null);
  const [muted, setMuted] = useState(sound.muted);
  const [copied, setCopied] = useState(false);
  const [buyAmt, setBuyAmt] = useState('');
  const [unread, setUnread] = useState(0);
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  const fullscreenOk = !!document.documentElement.requestFullscreen;
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => setToast({ id: Date.now(), text: 'Full screen is not allowed here.' }));
  };

  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // keep my own record of what I saw, for verification later
  useEffect(() => {
    const h = state?.hand;
    if (!h) return;
    const mine = state.me?.seat !== null && state.me?.seat !== undefined ? state.seats[state.me.seat]?.cards : null;
    witness.record(code, h.no, { commitment: h.commitment, ...(mine && mine.every((c) => c !== null) ? { mine } : {}) });
  }, [state?.hand?.no, state?.hand?.commitment, state?.me?.seat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast, setToast]);
  useEffect(() => { if (panel === 'chat') setUnread(0); else if (chat.length) setUnread((u) => u + 1); }, [chat.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (panel === 'chat') setUnread(0); }, [panel]);
  useEffect(() => { if (state?.settings) setBuyAmt((v) => v || String(state.settings.defaultBuyIn)); }, [state?.settings]);

  if (status === 'gone') {
    return (
      <main className="gone">
        <h1>No table with code {code}</h1>
        <p>Check the code with your host. Codes are 6 letters and numbers.</p>
        <button className="btn primary" onClick={onLeave}>Back to lobby</button>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="loading">
        <div className="spinner" aria-hidden="true" />
        <p className="muted">Connecting to table {code}…</p>
        {status === 'closed' && <button className="btn ghost" onClick={onLeave}>Back to lobby</button>}
      </main>
    );
  }

  const me = state.me;
  const mySeat = me?.seat !== null ? state.seats[me.seat] : null;
  const needsChips = mySeat && mySeat.stack === 0 && !mySeat.inHand && state.status !== 'ended';
  const link = `${location.origin}/t/${code}`;

  const hostWaiting = !!(me?.isHost && state.requests.length);
  // keep the bar up when there's something to press or answer there
  const pinBar = state.status !== 'running' || hostWaiting;

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setToast({ id: Date.now(), text: link }); }
  };

  const openPanel = (id) => setPanel(panel === id ? null : id);
  const tabs = [
    ['bill', 'sheet', 'Bill sheet', false],
    ['chat', 'chat', 'Chat', unread > 0],
    ['log', 'log', 'Hand log', false],
    ['fair', 'shield', 'Fairness', false],
    ...(me?.isHost ? [['host', 'host', 'Host', state.requests.length > 0]] : []),
  ];

  return (
    <div className={`table-screen ${panel ? 'with-panel' : ''} ${pinBar ? 'bar-pinned' : 'bar-auto'}`}>
      {/* the bar hides while you play; move the pointer to the top edge to bring it back */}
      <div className="top-zone" aria-hidden="true"><span className={`top-hint ${unread || hostWaiting ? 'dot' : ''}`} /></div>
      <header className="topbar">
        <button className="icon-btn" onClick={onLeave} aria-label="Back to lobby" title="Lobby"><Icon name="back" /></button>
        <div className="title">
          <h1>{state.name}</h1>
          <button className="code" onClick={copy} title="Copy invite link">
            <Icon name={copied ? 'check' : 'link'} size={14} />{copied ? 'Copied' : code}
          </button>
          <span className="blinds" title="Blinds">Blinds {chips(state.settings.smallBlind)}/{chips(state.settings.bigBlind)}</span>
        </div>
        <div className="top-actions">
          {me?.isHost && state.status !== 'running' && state.status !== 'ended' && (
            <button className="btn primary sm" onClick={() => send('start')}>{state.status === 'paused' ? 'Resume' : 'Start game'}</button>
          )}
          {me?.isHost && state.status === 'running' && <button className="btn sm" onClick={() => send('pause')}>Pause</button>}
          <span className="divider" />
          <button className="icon-btn" onClick={() => setMuted(sound.toggle())} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} title={muted ? 'Sound off' : 'Sound on'}><Icon name={muted ? 'mute' : 'sound'} /></button>
          <ThemePicker />
          {fullscreenOk && (
            <button className="icon-btn" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (F11)' : 'Full screen'}>
              <Icon name={full ? 'shrink' : 'expand'} />
            </button>
          )}
          <span className="divider" />
          <nav className="panel-tabs" aria-label="Panels">
            {tabs.map(([id, icon, label, dot]) => (
              <button key={id} className={`icon-btn ${panel === id ? 'on' : ''} ${dot ? 'dot' : ''}`} onClick={() => openPanel(id)} aria-pressed={panel === id} title={label}>
                <Icon name={icon} /><span className="icon-label">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {status !== 'open' && <div className="conn" role="status">Reconnecting…</div>}

      <div className="stage">
        <div className="play">
          <PokerTable state={state} serverNow={serverNow} onSit={(seat) => send('sit', { seat })} send={send} portrait={portrait} />
          <footer className="dock">
            {needsChips ? (
              <form className="buyin" onSubmit={(e) => { e.preventDefault(); send('buyin', { amount: Number(buyAmt) }); }}>
                {me.pendingRequest ? (
                  <p className="dock-note">Waiting for the host to approve your {chips(me.pendingRequest.amount)} chips…</p>
                ) : (
                  <>
                    <label htmlFor="buy">Buy in</label>
                    <input id="buy" type="number" min="1" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} />
                    <span className="muted">{money(Number(buyAmt) || 0, state.settings)}</span>
                    <button className="btn primary">{state.settings.autoApproveBuyIns || me.isHost ? 'Buy chips' : 'Ask host'}</button>
                    <button type="button" className="btn quiet" onClick={() => send('stand')}>Stand up</button>
                  </>
                )}
              </form>
            ) : me?.seat === null ? (
              state.status !== 'ended' && <p className="dock-note">You're watching. Pick an empty seat to play.</p>
            ) : (
              <ActionBar state={state} send={send} />
            )}
          </footer>
        </div>
        {panel && (
          <SidePanel tab={panel} setTab={setPanel} state={state} send={send} chat={chat} history={history} code={code} onClose={() => setPanel(null)} />
        )}
      </div>

      {toast && <div className="toast" role="alert" key={toast.id}>{toast.text}</div>}
    </div>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);
  return (
    <div className="theme-pick" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Table theme" title="Theme"><Icon name="palette" /></button>
      {open && (
        <div className="popover" role="menu">
          {THEMES.map((t) => (
            <button key={t.id} role="menuitemradio" aria-checked={theme === t.id} className={`theme-opt ${theme === t.id ? 'on' : ''}`} onClick={() => { setTheme(t.id); setOpen(false); }}>
              <span className={`swatch swatch-${t.id}`} aria-hidden="true"><i /><i /><i /></span>
              <span><strong>{t.name}</strong><small>{t.note}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
