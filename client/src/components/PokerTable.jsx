import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Card from './Card.jsx';
import Avatar from './Avatar.jsx';
import Chips, { ChipStack } from './Chips.jsx';
import { chips, sound } from '../lib.js';
import { BuyInPicker } from './BuyIn.jsx';
import Icon from './Icons.jsx';

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// The bar drains with a CSS animation started part-way through, so a turn costs
// no React work per frame. Keyed by deadline, so each new turn restarts it.
function TimerBar({ deadline, total, serverNow }) {
  const left = Math.max(0, Math.min(total * 1000, deadline - serverNow()));
  const style = { animationDuration: `${total}s`, animationDelay: `${-(total * 1000 - left)}ms` };
  return (
    <span className="timer" aria-hidden="true">
      <span style={style} />
    </span>
  );
}

// The table is a stadium (straight sides, round ends). Seats are spaced by equal
// distance along its edge, starting from the bottom centre and going clockwise,
// so any number of players spreads evenly, like chairs around a real table.
function stadium(cx, cy, W, H) {
  const segs = [];
  const line = (x0, y0, x1, y1) => segs.push({ line: true, x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) });
  const arc = (ax, ay, r, t0, sweep) => segs.push({ ax, ay, r, t0, len: r * sweep });
  if (W >= H) {
    const r = H / 2, a = (W - H) / 2;
    line(cx, cy + r, cx - a, cy + r);
    arc(cx - a, cy, r, Math.PI / 2, Math.PI);
    line(cx - a, cy - r, cx + a, cy - r);
    arc(cx + a, cy, r, -Math.PI / 2, Math.PI);
    line(cx + a, cy + r, cx, cy + r);
  } else {
    const r = W / 2, a = (H - W) / 2;
    arc(cx, cy + a, r, Math.PI / 2, Math.PI / 2);
    line(cx - r, cy + a, cx - r, cy - a);
    arc(cx, cy - a, r, Math.PI, Math.PI);
    line(cx + r, cy - a, cx + r, cy + a);
    arc(cx, cy + a, r, 0, Math.PI / 2);
  }
  const total = segs.reduce((n, s) => n + s.len, 0);
  // point at distance u along the edge, with the unit normal pointing into the table
  return (u) => {
    let left = ((u % total) + total) % total;
    for (const s of segs) {
      if (left > s.len && s !== segs[segs.length - 1]) { left -= s.len; continue; }
      if (s.line) {
        const k = s.len ? left / s.len : 0;
        const x = s.x0 + (s.x1 - s.x0) * k, y = s.y0 + (s.y1 - s.y0) * k;
        const nx = Math.sign(cx - x) * (s.x0 === s.x1 ? 1 : 0), ny = Math.sign(cy - y) * (s.y0 === s.y1 ? 1 : 0);
        return { x, y, nx, ny };
      }
      const t = s.t0 + left / s.r;
      return { x: s.ax + s.r * Math.cos(t), y: s.ay + s.r * Math.sin(t), nx: -Math.cos(t), ny: -Math.sin(t) };
    }
    return { x: cx, y: cy, nx: 0, ny: -1 };
  };
}

export default function PokerTable({ state, serverNow, onSit, send, portrait }) {
  const ref = useRef(null);
  const [sitAt, setSitAt] = useState(null); // empty seat whose popover is open
  const [collect, setCollect] = useState(null); // bets sliding into the pot
  const { w, h } = useSize(ref);
  const hand = state.hand;
  const N = state.seats.length;
  const mySeat = state.me?.seat ?? null;
  const pivot = mySeat ?? 0;

  // everything on the table scales with the space it has (--s in CSS)
  const s = portrait
    ? Math.min(1.15, Math.max(0.62, Math.min(w / 400, h / 660)))
    : Math.min(1.3, Math.max(0.62, Math.min(w / 1180, h / 680)));

  // seat footprint around its anchor (the centre of the name plate), in px
  const foot = portrait
    ? { half: 50 * s, up: 40 * s, upMe: 100 * s, down: 20 * s, top: 64 * s }
    : { half: 81 * s, up: 60 * s, upMe: 136 * s, down: 26 * s, top: 94 * s };

  // felt rectangle: room above for the top seats' cards, at the sides for the plates
  const felt = {
    left: foot.half + 10 * s,
    right: w - foot.half - 10 * s,
    top: foot.top, // tall enough for cards turned up at showdown
    bottom: h - foot.down - 14 * s,
  };
  const fw = Math.max(80, felt.right - felt.left), fh = Math.max(80, felt.bottom - felt.top);
  const cx = felt.left + fw / 2, cy = felt.top + fh / 2;
  const rail = (portrait ? 6 : 9) * s; // seats sit on the middle of the rail

  const seatsAt = useMemo(() => {
    const at = stadium(cx, cy, fw + rail * 2, fh + rail * 2);
    const R = Math.min(fw, fh) / 2 + rail, a = Math.abs(fw - fh) / 2;
    const perimeter = 4 * a + 2 * Math.PI * R;
    const out = [];
    for (let seat = 0; seat < N; seat++) {
      const k = (seat - pivot + N) % N;
      const p = at((k * perimeter) / N);
      const isMe = seat === mySeat;
      // push bets and the button in from the seat, clear of its cards and plate
      const clear = Math.abs(p.nx) * foot.half + Math.abs(p.ny) * (p.ny < 0 ? (isMe ? foot.upMe : foot.up) : foot.down);
      const d = clear + (portrait ? 16 : 26) * s;
      const tx = -p.ny, ty = p.nx;
      const side = (portrait ? 34 : 62) * s;
      out[seat] = {
        ...p,
        bet: { x: p.x + p.nx * d, y: p.y + p.ny * d },
        btn: { x: p.x + p.nx * d + tx * side, y: p.y + p.ny * d + ty * side },
      };
    }
    return out;
  }, [N, pivot, mySeat, cx, cy, fw, fh, rail, s, portrait]); // eslint-disable-line react-hooks/exhaustive-deps

  // cup holders on the rail, between the seats (only some themes show them)
  const cups = useMemo(() => {
    const at = stadium(cx, cy, fw + rail * 2, fh + rail * 2);
    const R = Math.min(fw, fh) / 2 + rail, a = Math.abs(fw - fh) / 2;
    const perimeter = 4 * a + 2 * Math.PI * R;
    return Array.from({ length: N }, (_, k) => at(((k + 0.5) * perimeter) / N));
  }, [N, cx, cy, fw, fh, rail]);

  // dealing order: left of the button, around the table
  const dealIndex = useMemo(() => {
    if (!hand) return {};
    const inHand = state.seats.filter((x) => x.inHand).map((x) => x.seat);
    inHand.sort((a, b) => ((a - hand.buttonSeat - 1 + N) % N) - ((b - hand.buttonSeat - 1 + N) % N));
    return Object.fromEntries(inHand.map((x, i) => [x, { i, n: inHand.length }]));
  }, [hand?.no]); // eslint-disable-line react-hooks/exhaustive-deps

  // bets slide into the pot when a betting round ends (or the hand does)
  const lastBets = useRef(null);
  const potAt = { x: cx, y: cy - (portrait ? 76 : 93) * s };
  useLayoutEffect(() => {
    const prevB = lastBets.current;
    const now = { no: hand?.no, street: hand?.street, over: !!hand?.result, bets: state.seats.filter((x) => x.bet > 0).map((x) => ({ seat: x.seat, amount: x.bet })) };
    lastBets.current = now;
    if (!prevB || !hand || prevB.no !== hand.no || !prevB.bets.length) return;
    const gone = prevB.bets.filter((b) => !(state.seats[b.seat]?.bet > 0) || now.over || now.street !== prevB.street);
    if (!gone.length || (!now.over && now.street === prevB.street && gone.length < prevB.bets.length && state.seats.some((x) => x.bet > 0))) return;
    const id = `${hand.no}-${prevB.street}-${now.over}`;
    setCollect({ id, items: gone.map((b) => ({ ...b, from: seatsAt[b.seat]?.bet })).filter((b) => b.from) });
    const t = setTimeout(() => setCollect((c) => (c?.id === id ? null : c)), 520);
    return () => clearTimeout(t);
  }, [hand?.no, hand?.street, !!hand?.result, state.seats.map((x) => x.bet).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // the seat popover closes if someone else takes that seat first
  useEffect(() => { if (sitAt !== null && !state.seats[sitAt]?.empty) setSitAt(null); }, [sitAt, state.seats]);

  // sound cues: a soft knock for a check, a quiet clink when chips go in, a flick per card
  const prev = useRef({});
  useEffect(() => {
    const p = prev.current;
    const boardLen = (hand?.board.length ?? 0) + (hand?.board2?.length ?? 0) + (hand?.rabbit?.length ?? 0);
    if (hand && hand.no !== p.no) {
      const n = Object.keys(dealIndex).length * 2;
      for (let i = 0; i < n; i++) setTimeout(() => sound.play('card'), i * 90);
    } else if (hand && boardLen > (p.board ?? 0)) {
      const added = boardLen - (p.board ?? 0);
      for (let i = 0; i < added; i++) setTimeout(() => sound.play('card'), 160 + i * 130);
    }
    const lasts = Object.fromEntries(state.seats.map((x) => [x.seat, x.last]));
    if (hand && hand.no === p.no) {
      for (const x of state.seats) {
        if (!x.last || x.last === p.lasts?.[x.seat]) continue;
        if (x.uid === state.me?.uid) continue; // my own actions sound on click, without the round trip
        if (x.last === 'Check') sound.play('check');
        else if (x.last !== 'Fold') sound.play('chip');
      }
    }
    if (hand?.toAct && hand.toAct === state.me?.uid && p.toAct !== hand.toAct) sound.play('turn');
    if (hand?.result && !p.result && hand.result.winners.some((x) => x.uid === state.me?.uid)) setTimeout(() => sound.play('win'), 300);
    prev.current = { no: hand?.no, board: boardLen, lasts, toAct: hand?.toAct, result: !!hand?.result };
  });

  const result = hand?.result;
  const winners = new Set(result?.winners.map((x) => x.uid) ?? []);
  const winningCards = new Set(result && !result.byFold ? result.winners.flatMap((x) => x.cards) : []);
  const avatarSize = Math.round((portrait ? 22 : 34) * s);
  const canSit = state.me && state.me.seat === null && state.status !== 'ended';

  return (
    <div className={`felt-wrap ${portrait ? 'portrait' : ''}`} ref={ref} style={{ '--s': s }}>
      {w > 0 && (
        <>
          <div className="felt" style={{ left: felt.left, top: felt.top, width: fw, height: fh }}>
            <div className="felt-line" />
            <div className="felt-mark">{state.name}</div>
          </div>
          {cups.map((p, i) => <i key={i} className="cup" style={{ left: p.x, top: p.y }} aria-hidden="true" />)}

          {/* pot, community cards, result */}
          <div className="center" style={{ left: cx, top: cy }}>
            <div className="pot-row">
              {result && (
                <div className="result" key={`r${hand.no}`}>
                  {result.runs ? result.runs.map((run, r) => (
                    <div key={r}>
                      <em className="run-label">Run {r + 1}</em>
                      {run.winners.map((x, i) => (
                        <span key={x.uid}>{i > 0 && ', '}<strong>{x.uid === state.me?.uid ? 'You' : x.name}</strong> {chips(x.amount)}<span className="result-hand"> · {x.hand}</span></span>
                      ))}
                    </div>
                  )) : result.winners.map((x) => (
                    <div key={x.uid}>
                      <strong>{x.uid === state.me?.uid ? 'You' : x.name}</strong> {x.uid === state.me?.uid ? 'win' : 'wins'} {chips(x.amount)}
                      {x.hand && <span className="result-hand"> · {x.hand}</span>}
                    </div>
                  ))}
                </div>
              )}
              {hand && hand.pot > 0 && !result && (
                <Chips amount={hand.pot} label="Pot" className="pot" />
              )}
              {hand && hand.pots.length > 1 && !result && (
                <span className="side-pots" title={hand.pots.map((p, i) => `${i ? `Side ${i}` : 'Main'}: ${chips(p)}`).join('\n')}>
                  {hand.pots.length - 1} side pot{hand.pots.length > 2 ? 's' : ''}
                </span>
              )}
            </div>
            {hand?.rit && !hand.rit.decided && <RunItTwice rit={hand.rit} state={state} serverNow={serverNow} />}
            <div className="boards">
              <Board cards={hand?.board} no={hand?.no} rabbit={hand?.rabbit} winningCards={winningCards} label={hand?.runs === 2 ? 'Run 1' : null} />
              {/* the second row is reserved as soon as everyone agrees, so nothing jumps when it's dealt */}
              {hand?.runs === 2 && <Board cards={hand.board2 ?? []} no={`${hand.no}-2`} shared={hand.rit?.from ?? 0} winningCards={winningCards} label="Run 2" second />}
            </div>
            <div className="below-board">
              {(hand?.canRabbit || state.awaitingDeal) && (
                <div className="after-hand">
                  {hand?.canRabbit && <button className="felt-btn" onClick={() => send('rabbit')}>Show what was coming</button>}
                  {state.awaitingDeal && state.seats.filter((x) => !x.empty && x.stack > 0 && !x.sittingOut).length >= 2 && <span className="felt-note">{state.me?.isHost ? 'Press Enter to deal the next hand' : 'Waiting for the host to deal'}</span>}
                </div>
              )}
              {!hand && state.status !== 'running' && <div className="center-note">{centerNote(state)}</div>}
              {!hand && state.status === 'running' && state.seats.filter((x) => !x.empty && x.stack > 0 && !x.sittingOut).length < 2 && (
                <div className="center-note">Waiting for at least two players with chips</div>
              )}
            </div>
          </div>

          {/* pot flies to the winner(s) */}
          {result && result.winners.map((x) => {
            const seat = state.seats.find((q) => q.uid === x.uid);
            if (!seat) return null;
            const p = seatsAt[seat.seat];
            return (
              <div key={`win-${hand.no}-${x.uid}`} className="pot-fly" style={{ left: cx, top: cy, '--dx': `${p.x - cx}px`, '--dy': `${p.y - cy}px` }}>
                <ChipStack amount={x.amount} />
              </div>
            );
          })}

          {state.seats.map((seat) => {
            const p = seatsAt[seat.seat];
            if (seat.empty) {
              return (
                <button key={seat.seat} className={`seat-empty ${canSit ? 'open' : ''} ${sitAt === seat.seat ? 'picked' : ''}`} style={{ left: p.x, top: p.y }} disabled={!canSit} onClick={() => setSitAt(sitAt === seat.seat ? null : seat.seat)} aria-label={`Seat ${seat.seat + 1}${canSit ? ', take this seat' : ', empty'}`} aria-expanded={sitAt === seat.seat}>
                  {canSit && <span>Sit</span>}
                </button>
              );
            }
            const isMe = seat.uid === state.me?.uid;
            const acting = hand?.toAct === seat.uid;
            const di = dealIndex[seat.seat];
            // the last action is a small tab on the plate's top edge, so names never get squeezed
            const tag = seat.last && !result && !seat.allIn ? seat.last : null; // all-in already shows in the stack line
            const away = !seat.connected ? 'Offline' : seat.sittingOut && !seat.inHand ? 'Sitting out' : null;
            const shown = seat.cards?.some((c) => c !== null);
            return (
              <React.Fragment key={seat.seat}>
                <div
                  className={`seat ${isMe ? 'me' : ''} ${acting ? 'acting' : ''} ${seat.folded ? 'folded' : ''} ${winners.has(seat.uid) ? 'winner' : ''} ${!seat.connected ? 'offline' : ''}`}
                  style={{ left: p.x, top: p.y }}
                >
                  {seat.cards && (
                    <div className={`hole ${isMe ? 'mine' : ''} ${shown && !isMe ? 'shown' : ''}`}>
                      {seat.cards.map((c, i) => (
                        <Card
                          key={`${hand.no}-${seat.seat}-${i}`}
                          card={c}
                          size={isMe ? 'mine' : 'seat'}
                          flip
                          delay={di ? (i * di.n + di.i) * 90 + (isMe ? 380 : 0) : 0}
                          from={di && !result ? { x: cx - p.x, y: cy - p.y } : undefined}
                          dim={(isMe && seat.folded) || (winningCards.size > 0 && c !== null && !winningCards.has(c))}
                          glow={winningCards.has(c)}
                        />
                      ))}
                    </div>
                  )}
                  <div className="plate">
                    <span className="avatar-wrap" title={away ?? undefined}>
                      <Avatar name={seat.name} src={seat.avatar} size={avatarSize} />
                      {away && <span className={`status-dot ${seat.connected ? 'away' : 'offline'}`} aria-label={away} />}
                    </span>
                    <span className="plate-text">
                      <span className="pname">{isMe ? 'You' : seat.name}</span>
                      <span className="pstack">{seat.allIn ? 'All-in' : chips(seat.stack)}</span>
                    </span>
                    {tag && <span className={`said said-${tag.toLowerCase().replace(/[^a-z]/g, '')}`} key={tag}>{tag}</span>}
                    {acting && hand.deadline && <TimerBar key={hand.deadline} deadline={hand.deadline} total={state.settings.turnSeconds} serverNow={serverNow} />}
                  </div>
                </div>
                {seat.bet > 0 && !result && (
                  <Chips key={`bet-${hand.no}-${seat.seat}-${hand.street}`} amount={seat.bet} className="bet" style={{ left: p.bet.x, top: p.bet.y }} />
                )}
                {hand && hand.buttonSeat === seat.seat && (
                  <div className="dealer-btn" style={{ left: p.btn.x, top: p.btn.y }} aria-label="Dealer button">D</div>
                )}
              </React.Fragment>
            );
          })}

          {collect && collect.items.map((b) => (
            <Chips key={`${collect.id}-${b.seat}`} amount={b.amount} className="bet collecting" style={{ left: b.from.x, top: b.from.y, '--dx': `${potAt.x - b.from.x}px`, '--dy': `${potAt.y - b.from.y}px` }} />
          ))}

          {canSit && sitAt !== null && seatsAt[sitAt] && (
            <SeatPopover
              at={seatsAt[sitAt]} cx={cx} cy={cy} seat={sitAt} state={state}
              onClose={() => setSitAt(null)}
              onSit={(buyIn) => { onSit(sitAt, buyIn); setSitAt(null); }}
            />
          )}
        </>
      )}
    </div>
  );
}

// Click an empty seat: pick your chips and sit, in one step.
function SeatPopover({ at, cx, cy, seat, state, onClose, onSit }) {
  const me = state.me;
  const hasChips = me.stack > 0;
  const [amt, setAmt] = useState(String(state.settings.defaultBuyIn));
  const ref = useRef(null);
  const approve = state.settings.autoApproveBuyIns || me.isHost;
  useEffect(() => {
    const off = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.('.seat-empty')) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc, true); };
  }, [onClose]);
  // open toward the middle of the table so it never hangs off the edge
  const below = at.y < cy;
  const side = at.x < cx - 40 ? 'right' : at.x > cx + 40 ? 'left' : 'mid';
  const n = Math.floor(Number(amt)) || 0;
  const valid = hasChips || n > 0;
  const name = state.players.find((p) => p.uid === me.uid)?.name ?? 'you';
  return (
    <form
      ref={ref}
      className={`popup seat-pop ${below ? 'below' : 'above'} side-${side}`}
      style={{ left: at.x, top: at.y }}
      onSubmit={(e) => { e.preventDefault(); if (valid) onSit(hasChips ? undefined : n); }}
      aria-label={`Sit in seat ${seat + 1}`}
    >
      <div className="pop-head">
        <div>
          <div className="pop-title">Take seat {seat + 1}</div>
          <div className="pop-sub">Playing as {name}</div>
        </div>
        <button type="button" className="pop-close" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </div>
      {hasChips
        ? <p className="pop-note">You bring your {chips(me.stack)} chips.</p>
        : <BuyInPicker value={amt} onChange={setAmt} settings={state.settings} autoFocus />}
      <button className="btn primary wide" disabled={!valid}>
        {hasChips ? 'Sit down' : approve ? `Sit down with ${chips(n)}` : `Sit down, ask for ${chips(n)}`}
      </button>
      {!hasChips && !approve && <p className="pop-foot">You sit right away; the host approves the chips.</p>}
    </form>
  );
}

function Board({ cards = [], no, rabbit, shared = 0, winningCards, second, label }) {
  return (
    <div className={`board ${second ? 'second' : ''}`}>
      {label && <span className="run-tag">{label}</span>}
      {[0, 1, 2, 3, 4].map((i) => {
        const c = cards?.[i];
        if (c === undefined) {
          const r = rabbit?.[i - (cards?.length ?? 0)];
          if (r !== undefined) return <Card key={`${no}-r${i}`} card={r} size="board" flip delay={(i - cards.length) * 130} className="rabbit" />;
          return <div key={`${no}-slot-${i}`} className="card card-board slot" aria-hidden="true" />;
        }
        // the second run shares the cards dealt before the all-in
        if (second && i < shared) return <div key={`${no}-s${i}`} className="card card-board slot shared" aria-hidden="true" />;
        const flopDelay = i < 3 ? i * 130 : 0;
        return (
          <Card
            key={`${no}-b${i}`}
            card={c}
            size="board"
            flip
            delay={flopDelay + 160}
            from={{ x: -40 - i * 8, y: -26 }}
            dim={winningCards.size > 0 && !winningCards.has(c)}
            glow={winningCards.has(c)}
          />
        );
      })}
    </div>
  );
}

function RunItTwice({ rit, state, serverNow }) {
  const me = state.me?.uid;
  const mine = me in rit.votes ? rit.votes[me] : undefined;
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((rit.deadline - serverNow()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [rit.deadline, serverNow]);
  const name = (uid) => (uid === me ? 'You' : state.players.find((p) => p.uid === uid)?.name ?? '?');
  return (
    <div className="rit" role="group" aria-label="Run it twice?">
      <div className="rit-head"><strong>Run it twice?</strong><span className="rit-time">{left}s</span></div>
      <div className="rit-votes">
        {Object.entries(rit.votes).map(([uid, v]) => (
          <span key={uid} className={`vote ${v === true ? 'yes' : v === false ? 'no' : ''}`}>{name(uid)}</span>
        ))}
      </div>
      <span className="felt-note">{mine === null ? 'Choose below. ' : ''}One "once" and the board runs once.</span>
    </div>
  );
}

function centerNote(state) {
  if (state.status === 'ended') return 'Session over. The bill sheet has the final numbers.';
  if (state.status === 'paused') return 'Paused by the host';
  return state.me?.isHost ? 'Take a seat, buy in, then press Start' : 'Waiting for the host to start';
}
