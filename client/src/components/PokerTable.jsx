import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Card from './Card.jsx';
import Avatar from './Avatar.jsx';
import { chips, sound } from '../lib.js';

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

function TimerBar({ deadline, total, serverNow }) {
  const [left, setLeft] = useState(1);
  useEffect(() => {
    let raf;
    const tick = () => {
      setLeft(Math.max(0, (deadline - serverNow()) / (total * 1000)));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [deadline, total, serverNow]);
  return (
    <span className={`timer ${left < 0.25 ? 'low' : ''}`} aria-hidden="true">
      <span style={{ transform: `scaleX(${left})` }} />
    </span>
  );
}

function ChipStack({ amount }) {
  // a few coloured discs whose count grows with the bet, like a real stack
  const discs = Math.min(5, 1 + Math.floor(Math.log10(Math.max(1, amount))));
  return (
    <span className="chipstack" aria-hidden="true">
      {Array.from({ length: discs }, (_, i) => <span key={i} className={`disc d${i % 4}`} style={{ '--n': i }} />)}
    </span>
  );
}

export default function PokerTable({ state, serverNow, onSit, portrait }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const hand = state.hand;
  const N = state.seats.length;
  const mySeat = state.me?.seat ?? null;
  const pivot = mySeat ?? 0;

  // everything on the table scales with the space it has (--s in CSS)
  const scale = portrait
    ? Math.min(1.1, Math.max(0.62, Math.min(w / 420, h / 640)))
    : Math.min(1.35, Math.max(0.68, Math.min(w / 1180, h / 660)));

  // felt geometry: leave room around the rail for the seats
  const pad = portrait ? { x: 44 * scale, y: 80 * scale } : { x: 150 * scale, y: 92 * scale };
  const cx = w / 2, cy = h / 2;
  const rx = Math.max(60, w / 2 - pad.x), ry = Math.max(60, h / 2 - pad.y);

  const pos = useMemo(() => {
    const out = [];
    for (let s = 0; s < N; s++) {
      const k = (s - pivot + N) % N;
      const a = Math.PI / 2 + (k * 2 * Math.PI) / N;
      const x = cx + rx * 1.02 * Math.cos(a);
      // keep the whole seat (cards + name box) on screen
      const half = (portrait ? 60 : 178) * scale;
      out[s] = { x: Math.min(w - half, Math.max(half, x)), y: cy + ry * 1.04 * Math.sin(a) };
    }
    return out;
  }, [N, pivot, cx, cy, rx, ry, w, scale, portrait]);

  // a point `reach` px from the seat toward the table centre, measured on an ellipse
  // so side seats reach past their cards and top/bottom seats past their box
  const toward = (p, reachX, reachY) => {
    const dx = cx - p.x, dy = cy - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const d = Math.hypot(reachX * ux, reachY * uy);
    return { x: p.x + ux * d, y: p.y + uy * d, ux, uy };
  };


  // dealing order: left of the button, around the table
  const dealIndex = useMemo(() => {
    if (!hand) return {};
    const inHand = state.seats.filter((s) => s.inHand).map((s) => s.seat);
    inHand.sort((a, b) => ((a - hand.buttonSeat - 1 + N) % N) - ((b - hand.buttonSeat - 1 + N) % N));
    return Object.fromEntries(inHand.map((s, i) => [s, { i, n: inHand.length }]));
  }, [hand?.no]); // eslint-disable-line react-hooks/exhaustive-deps

  // sound cues
  const prev = useRef({});
  useEffect(() => {
    const p = prev.current;
    if (hand && hand.no !== p.no) {
      const n = Object.keys(dealIndex).length * 2;
      for (let i = 0; i < n; i++) setTimeout(() => sound.play('card'), i * 90);
    } else if (hand && hand.board.length > (p.board ?? 0)) {
      const added = hand.board.length - (p.board ?? 0);
      for (let i = 0; i < added; i++) setTimeout(() => sound.play('card'), i * 140);
    }
    const betSum = state.seats.reduce((a, s) => a + (s.bet || 0), 0);
    if (hand && betSum > (p.betSum ?? 0) && hand.no === p.no) sound.play('chip');
    if (hand?.toAct && hand.toAct === state.me?.uid && p.toAct !== hand.toAct) sound.play('turn');
    if (hand?.result && !p.result && hand.result.winners.some((x) => x.uid === state.me?.uid)) setTimeout(() => sound.play('win'), 300);
    prev.current = { no: hand?.no, board: hand?.board.length ?? 0, betSum, toAct: hand?.toAct, result: !!hand?.result };
  });

  const result = hand?.result;
  const winners = new Set(result?.winners.map((x) => x.uid) ?? []);
  const winningCards = new Set(result && !result.byFold ? result.winners.flatMap((x) => x.cards) : []);
  const avatarSize = Math.round((portrait ? 30 : 46) * scale);

  return (
    <div className={`felt-wrap ${portrait ? 'portrait' : ''}`} ref={ref} style={{ '--s': scale }}>
      {w > 0 && (
        <>
          <div className="felt" style={{ left: cx - rx, top: cy - ry, width: rx * 2, height: ry * 2 }}>
            <div className="felt-mark">{state.name}</div>
          </div>

          {/* community cards + pot */}
          <div className="center" style={{ left: cx, top: cy }}>
            {hand && hand.pot > 0 && !result && (
              <div className="pot">
                <ChipStack amount={hand.pot} />
                <span>Pot {chips(hand.pot)}</span>
                {hand.pots.length > 1 && <span className="side-pots">{hand.pots.slice(1).map((p, i) => <em key={i}>Side {chips(p)}</em>)}</span>}
              </div>
            )}
            <div className="board">
              {[0, 1, 2, 3, 4].map((i) => {
                const c = hand?.board[i];
                if (c === undefined) return <div key={`${hand?.no}-slot-${i}`} className="card card-board slot" />;
                const flopDelay = i < 3 ? i * 130 : 0;
                return (
                  <Card
                    key={`${hand.no}-b${i}`}
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
            {result && (
              <div className="result" key={`r${hand.no}`}>
                {result.winners.map((x) => (
                  <div key={x.uid}>
                    <strong>{x.uid === state.me?.uid ? 'You' : x.name}</strong> {x.uid === state.me?.uid ? 'win' : 'wins'} {chips(x.amount)}
                    {x.hand && <span className="result-hand"> with {x.hand}</span>}
                  </div>
                ))}
              </div>
            )}
            {!hand && state.status !== 'running' && <div className="center-note">{centerNote(state)}</div>}
            {!hand && state.status === 'running' && state.seats.filter((x) => !x.empty && x.stack > 0 && !x.sittingOut).length < 2 && (
              <div className="center-note">Waiting for at least two players with chips</div>
            )}
          </div>

          {/* pot flies to the winner(s) */}
          {result && result.winners.map((x) => {
            const seat = state.seats.find((s) => s.uid === x.uid);
            if (!seat) return null;
            const p = pos[seat.seat];
            return (
              <div key={`win-${hand.no}-${x.uid}`} className="pot-fly" style={{ left: cx, top: cy, '--dx': `${p.x - cx}px`, '--dy': `${p.y - cy}px` }}>
                <ChipStack amount={x.amount} />
              </div>
            );
          })}

          {state.seats.map((s) => {
            const p = pos[s.seat];
            if (s.empty) {
              const canSit = state.me && state.me.seat === null && state.status !== 'ended';
              return (
                <button key={s.seat} className="seat-empty" style={{ left: p.x, top: p.y }} disabled={!canSit} onClick={() => onSit(s.seat)} aria-label={`Seat ${s.seat + 1}${canSit ? ', take this seat' : ', empty'}`}>
                  {canSit ? 'Sit here' : ''}
                </button>
              );
            }
            const isMe = s.uid === state.me?.uid;
            const acting = hand?.toAct === s.uid;
            const betPos = portrait ? toward(p, 70 * scale, 80 * scale) : toward(p, 250 * scale, 112 * scale);
            // dealer button sits on the felt beside the bet, offset sideways
            const side = (portrait ? 34 : 62) * scale;
            const btnPos = { x: betPos.x + betPos.uy * side, y: betPos.y - betPos.ux * side };
            const onRight = !portrait && p.x > cx + 40;
            const di = dealIndex[s.seat];
            return (
              <React.Fragment key={s.seat}>
                <div
                  className={`seat ${isMe ? 'me' : ''} ${acting ? 'acting' : ''} ${s.folded ? 'folded' : ''} ${winners.has(s.uid) ? 'winner' : ''} ${!s.connected ? 'offline' : ''} ${p.y < cy ? 'top' : 'bottom'} ${onRight ? 'right' : ''}`}
                  style={{ left: p.x, top: p.y }}
                >
                  {s.cards && (
                    <div className={`hole ${isMe ? 'mine' : ''}`}>
                      {s.cards.map((c, i) => (
                        <Card
                          key={`${hand.no}-${s.seat}-${i}`}
                          card={c}
                          size={isMe ? 'mine' : 'seat'}
                          flip
                          delay={di ? (i * di.n + di.i) * 90 + (isMe ? 380 : 0) : 0}
                          from={di && !result ? { x: cx - p.x, y: cy - p.y } : undefined}
                          dim={s.folded || (winningCards.size > 0 && c !== null && !winningCards.has(c))}
                          glow={winningCards.has(c)}
                        />
                      ))}
                    </div>
                  )}
                  <div className="plate">
                    <Avatar name={s.name} src={s.avatar} size={avatarSize} />
                    {acting && hand.deadline && <TimerBar deadline={hand.deadline} total={state.settings.turnSeconds} serverNow={serverNow} />}
                    <span className="plate-text">
                      <span className="pname">{isMe ? 'You' : s.name}</span>
                      <span className="pstack">{s.allIn ? 'All-in' : chips(s.stack)}</span>
                    </span>
                    {s.last && !result && <span className={`last last-${s.last.toLowerCase().replace(/[^a-z]/g, '')}`}>{s.last}</span>}
                    {s.sittingOut && !s.inHand && <span className="last away">Away</span>}
                    {!s.connected && <span className="last away">Offline</span>}
                    {hand && s.uid === state.hostId && <span className="host-dot" title="Host" />}
                  </div>
                </div>
                {s.bet > 0 && !result && (
                  <div className="bet" style={{ left: betPos.x, top: betPos.y }} key={`bet-${hand.no}-${s.seat}-${hand.street}`}>
                    <ChipStack amount={s.bet} />
                    <span>{chips(s.bet)}</span>
                  </div>
                )}
                {hand && hand.buttonSeat === s.seat && (
                  <div className="dealer-btn" style={{ left: btnPos.x, top: btnPos.y }} aria-label="Dealer button">D</div>
                )}
              </React.Fragment>
            );
          })}
        </>
      )}
    </div>
  );
}

function centerNote(state) {
  if (state.status === 'ended') return 'Session over. The bill sheet has the final numbers.';
  if (state.status === 'paused') return 'Paused by the host';
  return state.me?.isHost ? 'Take a seat, buy in, then press Start game' : 'Waiting for the host to start';
}
