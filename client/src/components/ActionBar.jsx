import React, { useEffect, useMemo, useRef, useState } from 'react';
import { chips } from '../lib.js';

export default function ActionBar({ state, send }) {
  const me = state.me;
  const hand = state.hand;
  const opt = me?.options;
  const [raiseTo, setRaiseTo] = useState(0);
  const [pre, setPre] = useState(null); // 'checkfold' | 'callany'
  const inputRef = useRef(null);

  const mySeat = me?.seat !== null && me?.seat !== undefined ? state.seats[me.seat] : null;
  const inHand = !!(hand && !hand.over && mySeat?.inHand && !mySeat.folded && !mySeat.allIn);

  // pot-sized raise: call first, then raise the size of the whole pot
  const presets = useMemo(() => {
    if (!opt?.canRaise) return [];
    const bets = state.seats.reduce((a, s) => a + (s.bet || 0), 0);
    const potAfterCall = hand.pot + bets + opt.toCall;
    const clamp = (v) => Math.max(opt.minTo, Math.min(opt.maxTo, Math.round(v)));
    const base = hand.currentBet;
    const list = [
      ['Min', opt.minTo],
      ['½ pot', clamp(base + potAfterCall / 2)],
      ['¾ pot', clamp(base + potAfterCall * 0.75)],
      ['Pot', clamp(base + potAfterCall)],
      ['All-in', opt.maxTo],
    ];
    return list.filter(([, v], i) => i === 0 || i === list.length - 1 || (v > opt.minTo && v < opt.maxTo));
  }, [opt, hand, state.seats]);

  useEffect(() => { if (opt?.canRaise) setRaiseTo(opt.minTo); }, [opt?.minTo, opt?.canRaise, hand?.no, hand?.street]);

  // clear queued pre-actions when a new hand starts
  useEffect(() => { setPre(null); }, [hand?.no]);
  // "check/fold" stays only while there's nothing to call; "call any" holds through raises
  useEffect(() => {
    if (!opt || !pre) return;
    if (pre === 'checkfold') send('act', { action: { type: opt.canCheck ? 'check' : 'fold' } });
    if (pre === 'callany') send('act', { action: { type: opt.canCheck ? 'check' : 'call' } });
    setPre(null);
  }, [opt, pre, send]);

  const act = (type, extra = {}) => send('act', { action: { type, ...extra } });

  useEffect(() => {
    if (!opt) return;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') act('fold');
      else if (k === 'c' || k === 'k') act(opt.canCheck ? 'check' : 'call');
      else if (k === 'r' && opt.canRaise) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!me || me.seat === null || state.status === 'ended') return null;

  if (opt) {
    const allIn = opt.canRaise && raiseTo >= opt.maxTo;
    const callAllIn = !opt.canCheck && opt.toCall >= mySeat.stack;
    const valid = Number.isInteger(raiseTo) && raiseTo >= opt.minTo && raiseTo <= opt.maxTo;
    return (
      <div className="actionbar live" role="group" aria-label="Your action">
        {me.handName && <div className="handname">{me.handName}</div>}
        {opt.canRaise && (
          <div className="raise-row">
            <div className="presets">
              {presets.map(([label, v]) => (
                <button key={label} className={`chip-btn ${raiseTo === v ? 'on' : ''}`} onClick={() => setRaiseTo(v)}>{label}</button>
              ))}
            </div>
            <div className="slider-row">
              <input type="range" min={opt.minTo} max={opt.maxTo} step={1} value={raiseTo} onChange={(e) => setRaiseTo(Number(e.target.value))} aria-label="Raise amount" />
              <input ref={inputRef} className="amount" type="number" inputMode="numeric" min={opt.minTo} max={opt.maxTo} value={raiseTo}
                onChange={(e) => setRaiseTo(Math.floor(Number(e.target.value)))}
                onKeyDown={(e) => { if (e.key === 'Enter' && valid) act('raise', { to: raiseTo }); }}
                aria-label="Raise to" />
            </div>
          </div>
        )}
        <div className="act-row">
          <button className="act fold" onClick={() => act('fold')}>Fold <kbd>F</kbd></button>
          {opt.canCheck
            ? <button className="act check" onClick={() => act('check')}>Check <kbd>C</kbd></button>
            : <button className="act call" onClick={() => act('call')}>{callAllIn ? 'Call all-in' : 'Call'} {chips(opt.toCall)} <kbd>C</kbd></button>}
          {opt.canRaise && (
            <button className="act raise" disabled={!valid} onClick={() => act('raise', { to: raiseTo })}>
              {allIn ? 'All-in' : opt.isBet ? 'Bet' : 'Raise to'} {chips(raiseTo || 0)}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="actionbar">
      {me.handName && <div className="handname">{me.handName}</div>}
      {inHand && (
        <div className="pre-row">
          <label className={`pre ${pre === 'checkfold' ? 'on' : ''}`}>
            <input type="checkbox" checked={pre === 'checkfold'} onChange={(e) => setPre(e.target.checked ? 'checkfold' : null)} /> Check / fold
          </label>
          <label className={`pre ${pre === 'callany' ? 'on' : ''}`}>
            <input type="checkbox" checked={pre === 'callany'} onChange={(e) => setPre(e.target.checked ? 'callany' : null)} /> Call any
          </label>
        </div>
      )}
      {!inHand && mySeat && (
        <div className="pre-row">
          {mySeat.sittingOut
            ? <button className="btn primary" onClick={() => send('sitout', { value: false })}>I'm back</button>
            : <button className="btn ghost" onClick={() => send('sitout', { value: true })}>Sit out next hand</button>}
          <button className="btn ghost" onClick={() => send('stand')}>{mySeat.inHand && !hand?.over ? 'Leave after this hand' : 'Stand up'}</button>
        </div>
      )}
    </div>
  );
}
