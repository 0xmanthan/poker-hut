import React, { useEffect, useMemo, useRef, useState } from 'react';
import { chips, sound } from '../lib.js';
import Icon from './Icons.jsx';

// Lives in the fixed-height dock under the table. Its height never changes with
// whose turn it is, so the table doesn't resize; bet sizing pops up over the felt.
export default function ActionBar({ state, send, errorTick, deal }) {
  const me = state.me;
  const hand = state.hand;
  const opt = me?.options;
  const [raiseTo, setRaiseTo] = useState(0);
  const [sizing, setSizing] = useState(false);
  const [pre, setPre] = useState(null); // 'checkfold' | 'callany'
  const inputRef = useRef(null);
  // the decision I just answered: buttons go away at once, without waiting for the server
  const [pending, setPending] = useState(null);

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
  useEffect(() => { if (!opt) setSizing(false); }, [opt]);
  const decision = opt ? `${hand.no}|${hand.street}|${hand.currentBet}|${opt.toCall}|${opt.minTo}|${hand.deadline}` : null;
  useEffect(() => { setPending(null); }, [errorTick]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 3000); // the server never answered: show the buttons again
    return () => clearTimeout(t);
  }, [pending]);

  // clear queued pre-actions when a new hand starts
  useEffect(() => { setPre(null); }, [hand?.no]);
  // "check/fold" stays only while there's nothing to call; "call any" holds through raises
  useEffect(() => {
    if (!opt || !pre) return;
    if (pre === 'checkfold') act(opt.canCheck ? 'check' : 'fold');
    if (pre === 'callany') act(opt.canCheck ? 'check' : 'call');
    setPre(null);
  }, [opt, pre, send]); // eslint-disable-line react-hooks/exhaustive-deps

  function act(type, extra = {}) {
    if (pending && pending === decision) return; // already answered (double click)
    setSizing(false);
    setPending(decision);
    if (type === 'check' || (type === 'call' && opt?.canCheck)) sound.play('check');
    else if (type !== 'fold') sound.play('chip');
    send('act', { action: { type, ...extra } });
  }
  const onlyAllIn = opt?.canRaise && opt.minTo >= opt.maxTo;
  const valid = opt?.canRaise && Number.isInteger(raiseTo) && raiseTo >= opt.minTo && raiseTo <= opt.maxTo;
  const raise = () => {
    if (onlyAllIn) return act('raise', { to: opt.maxTo });
    if (!sizing) { setSizing(true); return; }
    if (valid) act('raise', { to: raiseTo });
  };

  useEffect(() => { if (sizing) inputRef.current?.select(); }, [sizing]);
  // Escape closes the raise sizer before anything else
  useEffect(() => {
    if (!sizing) return;
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); setSizing(false); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [sizing]);

  useEffect(() => {
    if (!opt || pending === decision) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      // F fold, K check, C call (checks when there's nothing to call), R raise
      if (k === 'f') act('fold');
      else if (k === 'k') { if (opt.canCheck) act('check'); }
      else if (k === 'c') act(opt.canCheck ? 'check' : 'call');
      else if (k === 'r' && opt.canRaise) { e.preventDefault(); raise(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!me || me.seat === null || state.status === 'ended') return null;

  const handName = me.handName && <span className="handname">{me.handName}</span>;

  // run it twice: the decision lives where every other decision does
  const rit = hand?.rit;
  if (rit && !rit.decided && rit.votes[me.uid] === null) {
    return (
      <>
        <div className="dock-left"><span className="handname">Run it twice?</span></div>
        <div className="dock-right" role="group" aria-label="Run it twice?">
          <button className="act fold" onClick={() => send('rit', { yes: false })}>Run once</button>
          <button className="act raise" onClick={() => send('rit', { yes: true })}>Run it twice</button>
        </div>
      </>
    );
  }

  if (opt && pending !== decision) {
    const callAllIn = !opt.canCheck && opt.toCall >= mySeat.stack;
    const raiseLabel = onlyAllIn || (sizing && raiseTo >= opt.maxTo) ? 'All-in'
      : opt.isBet ? 'Bet' : 'Raise';
    return (
      <>
        <div className="dock-left">{handName}</div>
        <div className="dock-right" role="group" aria-label="Your action">
          <button className="act fold" onClick={() => act('fold')}>Fold<kbd>F</kbd></button>
          {opt.canCheck
            ? <button className="act check" onClick={() => act('check')}>Check<kbd>K</kbd></button>
            : <button className="act call" onClick={() => act('call')}>{callAllIn ? 'All-in' : 'Call'} <b>{chips(opt.toCall)}</b><kbd>C</kbd></button>}
          {opt.canRaise && (
            <button className={`act raise ${sizing ? 'sizing' : ''}`} disabled={sizing && !valid} onClick={raise}>
              {raiseLabel}{(sizing || onlyAllIn) && <b>{chips(onlyAllIn ? opt.maxTo : raiseTo || 0)}</b>}<kbd>R</kbd>
            </button>
          )}
        </div>
        {sizing && (
          <div className="sizer" role="dialog" aria-label="Choose your raise">
            <div className="sizer-presets">
              {presets.map(([label, v]) => (
                <button key={label} className={`preset ${raiseTo === v ? 'on' : ''}`} onClick={() => setRaiseTo(v)}>{label}</button>
              ))}
            </div>
            <div className="sizer-row">
              <button className="step" onClick={() => setRaiseTo((v) => Math.max(opt.minTo, v - state.settings.bigBlind))} aria-label="Less">−</button>
              <input type="range" min={opt.minTo} max={opt.maxTo} step={1} value={raiseTo} onChange={(e) => setRaiseTo(Number(e.target.value))} aria-label="Raise amount" />
              <button className="step" onClick={() => setRaiseTo((v) => Math.min(opt.maxTo, v + state.settings.bigBlind))} aria-label="More">+</button>
              <input ref={inputRef} className="amount" type="number" inputMode="numeric" min={opt.minTo} max={opt.maxTo} value={raiseTo}
                onChange={(e) => setRaiseTo(Math.floor(Number(e.target.value)))}
                onKeyDown={(e) => { if (e.key === 'Enter' && valid) act('raise', { to: raiseTo }); }}
                aria-label="Raise to" />
            </div>
            <button className="sizer-close" onClick={() => setSizing(false)}>Cancel</button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="dock-left">{handName}</div>
      <div className="dock-right">
        {deal}
        {inHand && !opt && (
          <>
            <button className={`pre ${pre === 'checkfold' ? 'on' : ''}`} aria-pressed={pre === 'checkfold'} onClick={() => setPre(pre === 'checkfold' ? null : 'checkfold')} title="When it's your turn: check if you can, otherwise fold">
              <span className="tick" aria-hidden="true"><Icon name="check" size={13} /></span>Auto check / fold
            </button>
            <button className={`pre ${pre === 'callany' ? 'on' : ''}`} aria-pressed={pre === 'callany'} onClick={() => setPre(pre === 'callany' ? null : 'callany')} title="When it's your turn: call whatever the bet is">
              <span className="tick" aria-hidden="true"><Icon name="check" size={13} /></span>Auto call any
            </button>
          </>
        )}
        {!inHand && mySeat && (
          <>
            {mySeat.sittingOut
              ? <button className="btn primary" onClick={() => send('sitout', { value: false })}>I'm back</button>
              : <button className="btn quiet" onClick={() => send('sitout', { value: true })}>Sit out next hand</button>}
            <button className="btn quiet" onClick={() => send('stand')}>{mySeat.inHand && !hand?.over ? 'Leave after this hand' : 'Stand up'}</button>
          </>
        )}
      </div>
    </>
  );
}
