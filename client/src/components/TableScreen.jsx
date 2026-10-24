import React, { useEffect, useState } from 'react';
import { useTable } from '../useTable.js';
import { chips, money, sound, witness } from '../lib.js';
import PokerTable from './PokerTable.jsx';
import ActionBar from './ActionBar.jsx';
import SidePanel from './SidePanel.jsx';

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
  const [panel, setPanel] = useState(() => (window.innerWidth > 1100 ? 'bill' : null));
  const [muted, setMuted] = useState(sound.muted);
  const [copied, setCopied] = useState(false);
  const [buyAmt, setBuyAmt] = useState('');
  const [unread, setUnread] = useState(0);

  // keep my own record of what I saw, for verification later
  useEffect(() => {
    const h = state?.hand;
    if (!h) return;
    const mine = state.me?.seat !== null && state.me?.seat !== undefined ? state.seats[state.me.seat]?.cards : null;
    witness.record(code, h.no, { commitment: h.commitment, ...(mine && mine.every((c) => c !== null) ? { mine } : {}) });
  }, [state?.hand?.no, state?.hand?.commitment, state?.me?.seat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast, setToast]);
  useEffect(() => { if (panel === 'chat') setUnread(0); else if (chat.length) setUnread((u) => u + 1); }, [chat.length]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setToast({ id: Date.now(), text: link }); }
  };

  return (
    <div className={`table-screen ${panel ? 'with-panel' : ''}`}>
      <header className="topbar">
        <button className="btn ghost sm" onClick={onLeave} aria-label="Back to lobby">‹ Lobby</button>
        <div className="title">
          <h1>{state.name}</h1>
          <button className="code" onClick={copy} title="Copy invite link">{copied ? 'Link copied' : code}</button>
        </div>
        <div className="top-actions">
          {me?.isHost && state.status !== 'running' && state.status !== 'ended' && (
            <button className="btn primary sm" onClick={() => send('start')}>{state.status === 'paused' ? 'Resume' : 'Start game'}</button>
          )}
          {me?.isHost && state.status === 'running' && <button className="btn ghost sm" onClick={() => send('pause')}>Pause</button>}
          <span className="blinds" title="Blinds">{chips(state.settings.smallBlind)}/{chips(state.settings.bigBlind)}</span>
          <button className="btn ghost sm icon" onClick={() => setMuted(sound.toggle())} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>{muted ? '🔇' : '🔊'}</button>
          <button className={`btn sm ${panel ? 'on' : 'ghost'} ${(me?.isHost && state.requests.length) || unread ? 'badge' : ''}`} onClick={() => setPanel(panel ? null : me?.isHost && state.requests.length ? 'host' : 'bill')}>
            {panel ? 'Hide panel' : 'Bill sheet'}
          </button>
        </div>
      </header>

      {status !== 'open' && <div className="conn" role="status">Reconnecting…</div>}

      <div className="stage">
        <div className="play">
          <PokerTable state={state} serverNow={serverNow} onSit={(seat) => send('sit', { seat })} portrait={portrait} />
          {needsChips ? (
            <form className="actionbar buyin-bar" onSubmit={(e) => { e.preventDefault(); send('buyin', { amount: Number(buyAmt) }); }}>
              {me.pendingRequest ? (
                <p>Waiting for the host to approve your {chips(me.pendingRequest.amount)} chips.</p>
              ) : (
                <>
                  <label htmlFor="buy">Buy in to play</label>
                  <input id="buy" type="number" min="1" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value)} />
                  <span className="muted">{money(Number(buyAmt) || 0, state.settings)}</span>
                  <button className="btn primary">{state.settings.autoApproveBuyIns || me.isHost ? 'Buy chips' : 'Ask host for chips'}</button>
                  <button type="button" className="btn ghost" onClick={() => send('stand')}>Stand up</button>
                </>
              )}
            </form>
          ) : (
            <ActionBar state={state} send={send} />
          )}
          {me?.seat === null && state.status !== 'ended' && <div className="actionbar spectate">You're watching. Pick an empty seat to play.</div>}
        </div>
        {panel && (
          <SidePanel tab={panel} setTab={setPanel} state={state} send={send} chat={chat} history={history} code={code} onClose={() => setPanel(null)} />
        )}
      </div>

      {toast && <div className="toast" role="alert" key={toast.id}>{toast.text}</div>}
    </div>
  );
}
