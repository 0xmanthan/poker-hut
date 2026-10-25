import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Card from './Card.jsx';
import Icon from './Icons.jsx';
import { chips, money, witness, verifyHand } from '../lib.js';

const TITLES = { bill: 'Bill sheet', chat: 'Chat', log: 'Hand log', fair: 'Fairness', host: 'Host controls' };

export default function SidePanel({ tab, state, send, chat, history, code, onClose }) {
  const isHost = state.me?.isHost;
  return (
    <aside className="side" aria-label={TITLES[tab]}>
      <header className="side-head">
        <h2>{TITLES[tab]}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close panel"><Icon name="close" /></button>
      </header>
      <div className="side-body">
        {tab === 'bill' && <BillSheet state={state} send={send} />}
        {tab === 'chat' && <Chat chat={chat} send={send} me={state.me?.uid} />}
        {tab === 'log' && <Log state={state} />}
        {tab === 'fair' && <Fairness state={state} send={send} history={history} code={code} />}
        {tab === 'host' && isHost && <HostPanel state={state} send={send} />}
      </div>
    </aside>
  );
}

function Amount({ value, onChange, label, autoFocus }) {
  return <input type="number" min="1" step="1" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder="Chips" autoFocus={autoFocus} />;
}

function BillSheet({ state, send }) {
  const { rows, payments, entries } = state.bill;
  const s = state.settings;
  const me = state.me;
  const [buy, setBuy] = useState(String(s.defaultBuyIn));
  const [lendTo, setLendTo] = useState('');
  const [lendAmt, setLendAmt] = useState('');
  const others = state.players.filter((p) => p.uid !== me?.uid);
  const name = (uid) => state.players.find((p) => p.uid === uid)?.name ?? 'Someone';

  return (
    <div className="bill">
      <p className="rate">One chip is worth {s.currency}{s.tokenValue.toLocaleString("en-IN")}. Blinds are {chips(s.smallBlind)}/{chips(s.bigBlind)}.</p>

      {rows.length === 0 ? (
        <p className="empty">Nobody has bought in yet. Buy-ins show up here as they happen.</p>
      ) : (
        <div className="scroll-x">
          <table className="sheet">
            <thead>
              <tr><th>Player</th><th>Bought</th><th title="Chips lent (+) or borrowed (−)">Loans</th><th>Stack</th><th>Net</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} className={r.uid === me?.uid ? 'mine' : ''}>
                  <td><span className="who"><Avatar name={r.name} src={r.avatar} size={22} /><span className="who-name">{r.name}</span></span></td>
                  <td>{chips(r.boughtIn)}{r.buyIns > 1 && <small> ×{r.buyIns}</small>}</td>
                  <td>
                    {!r.lent && !r.borrowed && '–'}
                    {r.lent > 0 && <span className="lent">+{chips(r.lent)}</span>}
                    {r.borrowed > 0 && <span className="borrowed">−{chips(r.borrowed)}</span>}
                  </td>
                  <td>{chips(r.stack)}</td>
                  <td className={r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}>
                    <span className="net-money">{money(r.net, s)}</span>
                    <small>{r.net > 0 ? '+' : ''}{chips(r.net)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payments.length > 0 && (
        <section>
          <h3>{state.status === 'ended' ? 'Settle up' : 'If you settled now'}</h3>
          <ul className="payments">
            {payments.map((p, i) => (
              <li key={i}><strong>{p.fromName}</strong> pays <strong>{p.toName}</strong> <span className="pay">{s.currency}{p.money.toLocaleString('en-IN')}</span></li>
            ))}
          </ul>
        </section>
      )}

      {me && state.status !== 'ended' && (
        <section className="bill-actions">
          <form onSubmit={(e) => { e.preventDefault(); send('buyin', { amount: Number(buy) }); }}>
            <h3>Buy chips</h3>
            {me.pendingRequest ? (
              <p className="muted">Waiting for the host to approve {chips(me.pendingRequest.amount)} chips.</p>
            ) : (
              <div className="row">
                <Amount value={buy} onChange={setBuy} label="Chips to buy" />
                <button className="btn primary">{s.autoApproveBuyIns || me.isHost ? 'Buy' : 'Ask host'}</button>
              </div>
            )}
            <p className="muted small">{chips(Number(buy) || 0)} chips = {money(Number(buy) || 0, s)}</p>
          </form>

          {others.length > 0 && (
            <form onSubmit={(e) => { e.preventDefault(); send('transfer', { from: me.uid, to: lendTo, amount: Number(lendAmt) }); setLendAmt(''); }}>
              <h3>Lend chips</h3>
              <p className="muted small">Moves chips from your stack to theirs. The sheet records that they owe you.</p>
              <div className="row">
                <select value={lendTo} onChange={(e) => setLendTo(e.target.value)} aria-label="Lend to">
                  <option value="">Choose player</option>
                  {others.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                </select>
                <Amount value={lendAmt} onChange={setLendAmt} label="Chips to lend" />
                <button className="btn" disabled={!lendTo || !(Number(lendAmt) > 0)}>Lend</button>
              </div>
            </form>
          )}
        </section>
      )}

      {state.pendingOps.length > 0 && (
        <section>
          <h3>After this hand</h3>
          <ul className="entries">
            {state.pendingOps.map((o, i) => (
              <li key={i}>{o.type === 'buyin' ? `${name(o.uid)} gets ${chips(o.amount)} chips` : `${name(o.from)} lends ${chips(o.amount)} to ${name(o.to)}`}</li>
            ))}
          </ul>
        </section>
      )}

      {entries.length > 0 && (
        <section>
          <h3>Every chip movement</h3>
          <ul className="entries">
            {[...entries].reverse().map((e) => (
              <li key={e.id}>
                <time>{new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                {e.type === 'buyin' ? `${name(e.uid)} bought ${chips(e.amount)} (${money(e.amount, s)})` : `${name(e.from)} lent ${chips(e.amount)} to ${name(e.to)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Chat({ chat, send, me }) {
  const [text, setText] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.length]);
  return (
    <div className="chat">
      <ul className="chat-list">
        {chat.length === 0 && <li className="empty">Say hi to the table.</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.uid === me ? 'mine' : ''}><strong>{m.name}</strong> {m.text}</li>
        ))}
        <li ref={end} />
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send('chat', { text }); setText(''); } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Message" aria-label="Chat message" />
        <button className="btn">Send</button>
      </form>
    </div>
  );
}

function Log({ state }) {
  return (
    <ul className="log">
      {[...state.log].reverse().map((l) => (
        <li key={l.id} className={l.text.startsWith('Hand #') ? 'hand-line' : ''}>{l.text}</li>
      ))}
    </ul>
  );
}

function Fairness({ state, send, history, code }) {
  const seen = witness.load(code);
  const [results, setResults] = useState({});
  const [checking, setChecking] = useState(false);
  const ended = state.status === 'ended';

  useEffect(() => { if (ended && !history) send('history'); }, [ended, history, send]);

  const verifyAll = async () => {
    setChecking(true);
    const out = {};
    for (const rec of history ?? []) out[rec.no] = await verifyHand(rec, seen[rec.no], state.me?.uid);
    setResults(out);
    setChecking(false);
  };

  const list = ended && history ? [...history].reverse() : [...state.fairness].reverse();
  const verified = Object.values(results);
  const allOk = verified.length > 0 && verified.every((r) => r.ok);

  return (
    <div className="fair">
      <p>Each hand uses one standard 52-card deck, shuffled by a cryptographic random number generator. Nothing is weighted, and the server never looks at who is winning.</p>
      <p className="muted">Before a card is dealt, the table publishes a fingerprint (SHA-256) of that hand's secret seed. Your browser saves every fingerprint it sees. When the host ends the session, the seeds are revealed and you can rebuild every deck yourself to check no card was changed.</p>
      {ended ? (
        <button className="btn primary" onClick={verifyAll} disabled={checking || !history?.length}>{checking ? 'Checking…' : `Verify all ${history?.length ?? ''} hands`}</button>
      ) : (
        <p className="muted small">Seeds unlock when the session ends, so nobody can see folded cards mid-game.</p>
      )}
      {verified.length > 0 && (
        <p className={allOk ? 'ok-banner' : 'bad-banner'} role="status">
          {allOk ? `All ${verified.length} hands check out.` : `${verified.filter((r) => !r.ok).length} hands failed verification.`}
        </p>
      )}
      <ul className="hands">
        {list.map((h) => {
          const r = results[h.no];
          return (
            <li key={h.no}>
              <div className="hand-head">
                <strong>Hand #{h.no}</strong>
                {r && <span className={r.ok ? 'ok' : 'bad'}>{r.ok ? 'Verified' : 'Mismatch'}</span>}
              </div>
              <code title="Fingerprint">{h.commitment.slice(0, 32)}…</code>
              {h.board?.length > 0 && <div className="mini-board">{h.board.map((c) => <Card key={c} card={c} size="xs" />)}</div>}
              {h.board2 && <div className="mini-board">{h.board2.map((c) => <Card key={c} card={c} size="xs" />)}</div>}
              {r && !r.ok && <ul className="checks">{r.checks.filter((c) => !c.ok).map((c, i) => <li key={i}>{c.label}</li>)}</ul>}
              {seen[h.no]?.commitment && seen[h.no].commitment !== h.commitment && <p className="bad">Fingerprint differs from what you saw live.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const TIMERS = [[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s'], [0, 'Off']];

function HostPanel({ state, send }) {
  const s = state.settings;
  const [form, setForm] = useState(s);
  const [mode, setMode] = useState('house'); // house | loan
  const [give, setGive] = useState({ uid: '', amount: String(s.defaultBuyIn) });
  const [tr, setTr] = useState({ from: '', to: '', amount: '' });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [edits, setEdits] = useState({});
  useEffect(() => setForm(s), [s]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const players = state.players;
  const handLive = state.hand && !state.hand.over;
  const numeric = ['smallBlind', 'bigBlind', 'tokenValue', 'defaultBuyIn', 'turnSeconds'];
  const flags = ['autoApproveBuyIns', 'autoDeal', 'rabbitHunt', 'runItTwice'];
  const dirty = numeric.some((k) => Number(form[k]) !== Number(s[k])) || flags.some((k) => form[k] !== s[k]) || form.pace !== s.pace;
  const save = (e) => {
    e.preventDefault();
    send('settings', { patch: { ...form, ...Object.fromEntries(numeric.map((k) => [k, Number(form[k])])) } });
  };
  const timerOptions = TIMERS.some(([v]) => v === Number(form.turnSeconds)) ? TIMERS : [[Number(form.turnSeconds), `${form.turnSeconds}s`], ...TIMERS];

  return (
    <div className="hostp">
      {state.requests.length > 0 && (
        <section className="box attention">
          <h3>Waiting for chips <span className="count">{state.requests.length}</span></h3>
          {state.requests.map((r) => (
            <div key={r.id} className="request">
              <strong>{r.name}</strong>
              <input type="number" min="1" value={edits[r.id] ?? r.amount} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} aria-label={`Chips for ${r.name}`} />
              <button className="btn primary sm" onClick={() => send('resolve', { id: r.id, approve: true, amount: Number(edits[r.id] ?? r.amount) })}>Approve</button>
              <button className="icon-btn" onClick={() => send('resolve', { id: r.id, approve: false })} aria-label={`Decline ${r.name}`} title="Decline"><Icon name="close" size={18} /></button>
            </div>
          ))}
        </section>
      )}

      <section className="box">
        <div className="box-head">
          <h3>Chips</h3>
          <div className="seg" role="tablist" aria-label="Chip action">
            <button role="tab" aria-selected={mode === 'house'} className={mode === 'house' ? 'on' : ''} onClick={() => setMode('house')}>From house</button>
            <button role="tab" aria-selected={mode === 'loan'} className={mode === 'loan' ? 'on' : ''} onClick={() => setMode('loan')}>Loan</button>
          </div>
        </div>
        {mode === 'house' ? (
          <form className="chip-form" onSubmit={(e) => { e.preventDefault(); send('hostBuyIn', { uid: give.uid, amount: Number(give.amount) }); }}>
            <select value={give.uid} onChange={(e) => setGive({ ...give, uid: e.target.value })} aria-label="Player">
              <option value="">Player…</option>
              {players.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select>
            <input type="number" min="1" value={give.amount} onChange={(e) => setGive({ ...give, amount: e.target.value })} aria-label="Chips" />
            <button className="btn primary" disabled={!give.uid || !(Number(give.amount) > 0)}>Give</button>
            <p className="hint">Counts as a buy-in on the bill sheet.</p>
          </form>
        ) : (
          <form className="chip-form" onSubmit={(e) => { e.preventDefault(); send('transfer', { from: tr.from, to: tr.to, amount: Number(tr.amount) }); setTr({ from: '', to: '', amount: '' }); }}>
            <select value={tr.from} onChange={(e) => setTr({ ...tr, from: e.target.value })} aria-label="Lender">
              <option value="">Lender…</option>
              {players.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select>
            <select value={tr.to} onChange={(e) => setTr({ ...tr, to: e.target.value })} aria-label="Borrower">
              <option value="">Borrower…</option>
              {players.filter((p) => p.uid !== tr.from).map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select>
            <input type="number" min="1" value={tr.amount} onChange={(e) => setTr({ ...tr, amount: e.target.value })} placeholder="Chips" aria-label="Chips" />
            <button className="btn primary" disabled={!tr.from || !tr.to || !(Number(tr.amount) > 0)}>Record</button>
            <p className="hint">Moves chips between stacks. The borrower owes the lender.</p>
          </form>
        )}
      </section>

      <section className="box">
        <h3>Game</h3>
        <form className="settings" onSubmit={save}>
          <label className="field"><span>Blinds</span>
            <span className="pair">
              <input type="number" min="1" value={form.smallBlind} onChange={set('smallBlind')} aria-label="Small blind" />
              <i>/</i>
              <input type="number" min="2" value={form.bigBlind} onChange={set('bigBlind')} aria-label="Big blind" />
            </span>
          </label>
          <label className="field"><span>Usual buy-in</span><input type="number" min="1" value={form.defaultBuyIn} onChange={set('defaultBuyIn')} /></label>
          <label className="field"><span>1 chip = {form.currency}</span><input type="number" min="0.01" step="0.01" value={form.tokenValue} onChange={set('tokenValue')} /></label>
          <label className="field"><span>Turn timer</span>
            <select value={form.turnSeconds} onChange={set('turnSeconds')}>
              {timerOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="field full"><span>Dealer speed</span>
            <div className="seg wide" role="radiogroup" aria-label="Dealer speed">
              {[['relaxed', 'Relaxed'], ['normal', 'Normal'], ['fast', 'Fast']].map(([v, l]) => (
                <button type="button" key={v} role="radio" aria-checked={form.pace === v} className={form.pace === v ? 'on' : ''} onClick={() => setForm({ ...form, pace: v })}>{l}</button>
              ))}
            </div>
          </div>
          <Switch checked={form.autoDeal} onChange={set('autoDeal')} label="Deal the next hand automatically" note="Off: you press Deal for every hand." />
          <Switch checked={form.runItTwice} onChange={set('runItTwice')} label="Offer run it twice" note="On an all-in, everyone in the pot votes. One no means once." />
          <Switch checked={form.rabbitHunt} onChange={set('rabbitHunt')} label="Allow rabbit hunting" note="After a fold, anyone can see the cards that would have come." />
          <Switch checked={form.autoApproveBuyIns} onChange={set('autoApproveBuyIns')} label="Approve buy-ins automatically" />
          {dirty && (
            <div className="save-row">
              <button className="btn primary">Save</button>
              <button type="button" className="btn quiet" onClick={() => setForm(s)}>Undo</button>
              <span className="hint">Changes apply from the next hand.</span>
            </div>
          )}
        </form>
      </section>

      <section className="box">
        <h3>Players</h3>
        <ul className="seat-list">
          {players.filter((p) => p.seat !== null).map((p) => (
            <li key={p.uid}>
              <Avatar name={p.name} src={p.avatar} size={26} />
              <span className="sl-name">{p.name}{!p.connected && <em> · offline</em>}</span>
              <span className="sl-stack">{chips(p.stack)}</span>
              {p.uid !== state.me.uid
                ? <button className="icon-btn" onClick={() => send('removeFromSeat', { uid: p.uid })} aria-label={`Stand ${p.name} up`} title="Stand up (chips stay on the sheet)"><Icon name="trash" size={17} /></button>
                : <span className="sl-you">you</span>}
            </li>
          ))}
        </ul>
        {handLive && state.hand.toAct && <button className="btn quiet sm" onClick={() => send('forceFold')}>Fold the player who's thinking</button>}
      </section>

      <section className="box danger-zone">
        {!confirmEnd ? (
          <button className="btn danger" disabled={state.status === 'ended'} onClick={() => setConfirmEnd(true)}>End session</button>
        ) : (
          <div className="confirm">
            <p>End the session for everyone? No more hands. The bill sheet stays and seeds are revealed for checking.</p>
            <div className="row">
              <button className="btn danger" onClick={() => { send('end'); setConfirmEnd(false); }}>{handLive ? 'End after this hand' : 'End now'}</button>
              <button className="btn quiet" onClick={() => setConfirmEnd(false)}>Keep playing</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Switch({ checked, onChange, label, note }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={onChange} />
      <span className="track" aria-hidden="true" />
      <span>{label}{note && <small>{note}</small>}</span>
    </label>
  );
}
