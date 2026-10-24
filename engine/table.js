// No-limit Texas Hold'em table. Server-authoritative and transport-agnostic:
// the host (a Durable Object, or a test) calls methods and listens for 'change'.

import { newSeed, commitment, deckFromSeed } from './deck.js';
import { evaluate, describe, bestFive } from './evaluator.js';
import { Ledger, settle } from './ledger.js';

export const DEFAULT_SETTINGS = {
  smallBlind: 5,
  bigBlind: 10,
  tokenValue: 1,
  currency: '₹',
  defaultBuyIn: 1000,
  turnSeconds: 30,
  autoApproveBuyIns: false,
  maxSeats: 9,
};

const TIMINGS = { street: 700, runout: 1600, showdown: 5000, foldWin: 2200, nextHand: 900 };

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };
const isPosInt = (n) => Number.isInteger(n) && n > 0;

export class Table {
  constructor({ id, name, host, settings, timings, schedule, clear, now, onChange, onSessionEnd, shuffle }) {
    this.id = id;
    this.name = name;
    this.hostId = host.id;
    this.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
    this.players = new Map();
    this.seats = new Array(this.settings.maxSeats).fill(null);
    this.ledger = new Ledger();
    this.requests = [];      // pending buy-in requests awaiting the host
    this.pendingOps = [];    // chip movements that wait until the current hand ends
    this.hand = null;
    this.handNo = 0;
    this.buttonSeat = -1;
    this.status = 'waiting'; // waiting -> running <-> paused -> ended
    this.history = [];       // per-hand fairness record
    this.log = [];
    this.lastResult = null;
    this.createdAt = Date.now();
    this.timings = { ...TIMINGS, ...timings };
    this.schedule = schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.clear = clear ?? ((h) => clearTimeout(h));
    this.now = now ?? (() => Date.now());
    this.onChange = onChange ?? (() => {});
    this.onSessionEnd = onSessionEnd ?? (() => {});
    // tests can stack the deck; real games always use a fresh CSPRNG seed
    this.shuffle = shuffle ?? (() => { const seed = newSeed(); return { seed, deck: deckFromSeed(seed) }; });
    this.flowTimer = null;
    this.turnTimer = null;
    this.seq = 0;
    this.join(host);
  }

  // ---------- people ----------

  join(user) {
    let p = this.players.get(user.id);
    if (!p) {
      p = { id: user.id, name: user.name, avatar: user.avatar ?? null, seat: null, stack: 0, sittingOut: false, connected: true, leaveAfterHand: false, timeouts: 0 };
      this.players.set(user.id, p);
    } else {
      p.name = user.name;
      p.avatar = user.avatar ?? p.avatar;
    }
    p.connected = true;
    this.changed();
    return p;
  }

  setConnected(uid, connected) {
    const p = this.players.get(uid);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    this.changed();
  }

  player(uid) {
    return this.players.get(uid) ?? fail('You are not at this table.');
  }

  isHost(uid) { return uid === this.hostId; }
  requireHost(uid) { if (!this.isHost(uid)) fail('Only the host can do that.'); }

  inHand(uid) {
    const h = this.hand;
    return !!(h && !h.over && h.ps.has(uid) && !h.ps.get(uid).folded);
  }

  // dealt into the current, unfinished hand (even if folded) — chips are locked until it ends
  dealtIn(uid) {
    const h = this.hand;
    return !!(h && !h.over && h.ps.has(uid));
  }

  sit(uid, seat) {
    const p = this.player(uid);
    if (this.status === 'ended') fail('This session has ended.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats.length) fail('That seat does not exist.');
    if (this.seats[seat] !== null) fail('That seat is taken.');
    if (p.seat !== null) {
      if (this.dealtIn(uid)) fail('Finish this hand before changing seats.');
      this.seats[p.seat] = null;
    }
    this.seats[seat] = uid;
    p.seat = seat;
    p.sittingOut = false;
    p.leaveAfterHand = false;
    this.addLog(`${p.name} sat down`);
    this.changed();
    this.maybeStartHand();
  }

  standUp(uid) {
    const p = this.player(uid);
    if (p.seat === null) return;
    if (this.dealtIn(uid)) {
      p.leaveAfterHand = true;
      if (this.inHand(uid)) this.foldOutOfTurn(uid);
      this.changed();
      return;
    }
    this.seats[p.seat] = null;
    p.seat = null;
    this.addLog(`${p.name} stood up`);
    this.changed();
  }

  foldOutOfTurn(uid) {
    const h = this.hand;
    if (h.toAct === uid) return this.act(uid, { type: 'fold' }, true);
    const s = h.ps.get(uid);
    s.folded = true;
    s.last = 'Fold';
    this.addLog(`${this.players.get(uid).name} folds`);
    if (this.liveStates().length === 1) return this.finishByFold();
    // the player whose turn it is may no longer have anything to decide
    const cur = h.toAct && h.ps.get(h.toAct);
    if (cur && !this.needsAction(cur)) this.afterAction();
  }

  // host frees a seat (e.g. someone left without standing up); their chips stay on the bill sheet
  removeFromSeat(uid, targetUid) {
    this.requireHost(uid);
    this.standUp(targetUid);
  }

  setSittingOut(uid, value) {
    const p = this.player(uid);
    p.sittingOut = !!value;
    p.timeouts = 0;
    this.changed();
    if (!value) this.maybeStartHand();
  }

  // ---------- host controls ----------

  updateSettings(uid, patch) {
    this.requireHost(uid);
    const next = sanitizeSettings({ ...this.settings, ...patch, maxSeats: this.settings.maxSeats });
    this.settings = next;
    this.addLog('Host updated the table settings');
    this.changed();
  }

  start(uid) {
    this.requireHost(uid);
    if (this.status === 'ended') fail('This session has ended.');
    this.status = 'running';
    this.endAfterHand = false;
    this.addLog('Game started');
    this.changed();
    this.maybeStartHand();
  }

  pause(uid) {
    this.requireHost(uid);
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.addLog(this.hand && !this.hand.over ? 'Host paused the game. It stops after this hand.' : 'Host paused the game');
    this.changed();
  }

  endSession(uid) {
    this.requireHost(uid);
    if (this.status === 'ended') return;
    if (this.hand && !this.hand.over) {
      // let the hand play out, then close the table
      this.endAfterHand = true;
      if (this.status === 'running') this.status = 'paused';
      this.addLog('Host is ending the session after this hand');
      this.changed();
      return;
    }
    this.closeSession();
  }

  closeSession() {
    this.status = 'ended';
    this.endAfterHand = false;
    this.clear(this.flowTimer);
    this.flowTimer = null;
    this.hand = null;
    this.addLog('Session ended. Seeds revealed for verification.');
    this.changed();
    this.onSessionEnd(this);
  }

  forceFold(uid) {
    this.requireHost(uid);
    const h = this.hand;
    if (!h || h.over || !h.toAct) fail('Nobody is acting right now.');
    this.timeoutAct(h.toAct, true);
  }

  // ---------- chips & bill sheet ----------

  requestBuyIn(uid, amount) {
    const p = this.player(uid);
    if (!isPosInt(amount)) fail('Enter a whole number of chips.');
    if (this.status === 'ended') fail('This session has ended.');
    if (this.isHost(uid) || this.settings.autoApproveBuyIns) {
      this.applyOrQueue({ type: 'buyin', uid, amount, by: uid });
      return { approved: true };
    }
    if (this.requests.some((r) => r.uid === uid)) fail('You already have a buy-in waiting for the host.');
    this.requests.push({ id: ++this.seq, uid, name: p.name, amount, at: this.now() });
    this.addLog(`${p.name} asked for ${amount} chips`);
    this.changed();
    return { approved: false };
  }

  resolveRequest(uid, requestId, approve, amount) {
    this.requireHost(uid);
    const i = this.requests.findIndex((r) => r.id === requestId);
    if (i < 0) fail('That request is gone.');
    const [req] = this.requests.splice(i, 1);
    if (approve) {
      const amt = amount === undefined ? req.amount : amount;
      if (!isPosInt(amt)) fail('Enter a whole number of chips.');
      this.applyOrQueue({ type: 'buyin', uid: req.uid, amount: amt, by: uid });
    } else {
      this.addLog(`Host declined ${req.name}'s buy-in`);
      this.changed();
    }
  }

  // host gives chips from the house directly
  hostBuyIn(uid, targetUid, amount) {
    this.requireHost(uid);
    this.player(targetUid);
    if (!isPosInt(amount)) fail('Enter a whole number of chips.');
    this.applyOrQueue({ type: 'buyin', uid: targetUid, amount, by: uid });
  }

  // a player lends chips to another player (or the host records it for them)
  transfer(uid, fromUid, toUid, amount) {
    if (uid !== fromUid) this.requireHost(uid);
    if (fromUid === toUid) fail('Pick someone else to send chips to.');
    const from = this.player(fromUid);
    this.player(toUid);
    if (!isPosInt(amount)) fail('Enter a whole number of chips.');
    const pendingOut = this.pendingOps.filter((o) => o.type === 'transfer' && o.from === fromUid).reduce((s, o) => s + o.amount, 0);
    if (amount + pendingOut > from.stack) fail(`${from.name} only has ${from.stack - pendingOut} chips to send.`);
    this.applyOrQueue({ type: 'transfer', from: fromUid, to: toUid, amount, by: uid });
  }

  applyOrQueue(op) {
    const busy = op.type === 'buyin' ? this.dealtIn(op.uid) : this.dealtIn(op.from) || this.dealtIn(op.to);
    if (busy) {
      this.pendingOps.push(op);
      const who = this.players.get(op.uid ?? op.from).name;
      this.addLog(op.type === 'buyin' ? `${who}'s ${op.amount} chips arrive after this hand` : `${who}'s transfer goes through after this hand`);
      this.changed();
      return;
    }
    this.applyOp(op);
    this.changed();
    this.maybeStartHand();
  }

  applyOp(op) {
    if (op.type === 'buyin') {
      const p = this.players.get(op.uid);
      p.stack += op.amount;
      this.ledger.add({ type: 'buyin', uid: op.uid, amount: op.amount, by: op.by });
      this.addLog(`${p.name} bought in for ${op.amount}`);
    } else {
      const from = this.players.get(op.from), to = this.players.get(op.to);
      const amount = Math.min(op.amount, from.stack); // a queued transfer can't exceed what's left after the hand
      if (amount <= 0) { this.addLog(`${from.name}'s transfer to ${to.name} was cancelled (no chips left)`); return; }
      from.stack -= amount;
      to.stack += amount;
      this.ledger.add({ type: 'transfer', from: op.from, to: op.to, amount, by: op.by });
      this.addLog(`${from.name} lent ${amount} chips to ${to.name}`);
    }
  }

  billSheet() {
    const h = this.hand;
    const stackOf = (uid) => (h && !h.over && uid in h.startStacks ? h.startStacks[uid] : this.players.get(uid)?.stack ?? 0);
    const rows = this.ledger.rows(this.players, this.settings.tokenValue, stackOf);
    return { rows, payments: settle(rows, this.settings.tokenValue), entries: this.ledger.entries.slice(-200) };
  }

  // ---------- hand lifecycle ----------

  eligibleSeats() {
    const out = [];
    for (let s = 0; s < this.seats.length; s++) {
      const uid = this.seats[s];
      if (!uid) continue;
      const p = this.players.get(uid);
      if (p.stack > 0 && !p.sittingOut && !p.leaveAfterHand) out.push(s);
    }
    return out;
  }

  maybeStartHand() {
    if (this.status !== 'running' || this.hand?.over === false || this.flowTimer) return;
    if (this.eligibleSeats().length < 2) return;
    this.later(this.timings.nextHand, () => this.startHand());
  }

  later(ms, fn) {
    this.clear(this.flowTimer);
    this.flowTimer = this.schedule(() => { this.flowTimer = null; fn(); }, ms);
  }

  startHand() {
    if (this.status !== 'running') return;
    const seats = this.eligibleSeats();
    if (seats.length < 2) { this.hand = null; this.changed(); return; }

    const next = (from) => seats.find((s) => s > from) ?? seats[0];
    this.buttonSeat = next(this.buttonSeat);
    const headsUp = seats.length === 2;
    const sbSeat = headsUp ? this.buttonSeat : next(this.buttonSeat);
    const bbSeat = next(sbSeat);

    // seats in dealing order: first card goes to the left of the button
    const order = [];
    for (let s = next(this.buttonSeat), i = 0; i < seats.length; i++, s = next(s)) order.push(s);

    const { seed, deck } = this.shuffle();
    const h = {
      no: ++this.handNo,
      seed,
      commitment: commitment(seed),
      deck,
      pos: 0,
      order,
      ps: new Map(),
      board: [],
      street: 'preflop',
      buttonSeat: this.buttonSeat,
      sbSeat,
      bbSeat,
      currentBet: 0,
      bigBlind: this.settings.bigBlind,
      minRaise: this.settings.bigBlind,
      raiseCount: 0,
      toAct: null,
      deadline: null,
      showAll: false,
      over: false,
      result: null,
      startStacks: {},
    };
    this.hand = h;
    this.lastResult = null;

    for (const s of order) {
      const uid = this.seats[s];
      const p = this.players.get(uid);
      h.startStacks[uid] = p.stack;
      h.ps.set(uid, { uid, seat: s, cards: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, voluntary: false, seen: 0, last: null });
    }

    // deal two rounds, one card at a time, like a dealer would
    for (let r = 0; r < 2; r++) for (const s of order) h.ps.get(this.seats[s]).cards.push(h.deck[h.pos++]);

    this.post(this.seats[sbSeat], this.settings.smallBlind, 'SB');
    this.post(this.seats[bbSeat], this.settings.bigBlind, 'BB');
    h.currentBet = h.bigBlind;

    this.history.push({ no: h.no, commitment: h.commitment, seed: h.seed, order: order.map((s) => this.seats[s]), board: [], at: this.now() });
    if (this.history.length > 1000) this.history.shift();

    this.addLog(`Hand #${h.no}`);
    this.setTurn(this.nextToAct(bbSeat));
    this.changed();
    if (!h.toAct) this.endStreet();
  }

  post(uid, amount, label) {
    const p = this.players.get(uid), ps = this.hand.ps.get(uid);
    const amt = Math.min(amount, p.stack);
    p.stack -= amt;
    ps.bet += amt;
    ps.total += amt;
    ps.last = label;
    if (p.stack === 0) ps.allIn = true;
  }

  liveStates() { return [...this.hand.ps.values()].filter((s) => !s.folded); }
  actorStates() { return this.liveStates().filter((s) => !s.allIn); }

  needsAction(s) {
    const h = this.hand;
    if (s.folded || s.allIn) return false;
    if (s.bet < h.currentBet) return true;
    if (s.acted) return false;
    // nothing to decide when everyone else is all-in and the bet is matched
    return this.actorStates().some((o) => o !== s);
  }

  // first player clockwise after `fromSeat` who still has a decision to make
  nextToAct(fromSeat) {
    const h = this.hand;
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const uid = this.seats[(fromSeat + i) % n];
      const s = uid && h.ps.get(uid);
      if (s && s.seat === (fromSeat + i) % n && this.needsAction(s)) return s.uid;
    }
    return null;
  }

  setTurn(uid) {
    const h = this.hand;
    this.clear(this.turnTimer);
    this.turnTimer = null;
    h.toAct = uid;
    h.deadline = null;
    if (!uid) return;
    const secs = this.settings.turnSeconds;
    const p = this.players.get(uid);
    if (secs > 0) {
      const ms = (p.sittingOut || !p.connected ? Math.min(secs, 8) : secs) * 1000;
      h.deadline = this.now() + ms;
      const handNo = h.no;
      this.turnTimer = this.schedule(() => {
        if (this.hand?.no === handNo && this.hand.toAct === uid && !this.hand.over) this.timeoutAct(uid, false);
      }, ms);
    }
  }

  timeoutAct(uid, forced) {
    const s = this.hand.ps.get(uid);
    const p = this.players.get(uid);
    const canCheck = s.bet >= this.hand.currentBet;
    if (!forced) {
      p.timeouts++;
      if (p.timeouts >= 2 && !p.sittingOut) { p.sittingOut = true; this.addLog(`${p.name} is away`); }
    }
    this.act(uid, { type: canCheck ? 'check' : 'fold' }, true);
  }

  // What the acting player may do right now.
  options(uid) {
    const h = this.hand;
    if (!h || h.over || h.toAct !== uid) return null;
    const s = h.ps.get(uid), p = this.players.get(uid);
    const toCall = Math.min(h.currentBet - s.bet, p.stack);
    const maxTo = s.bet + p.stack;
    const othersCanAct = this.actorStates().some((o) => o !== s);
    // after an incomplete all-in raise, players who already acted may only call or fold
    const reopened = !s.voluntary || s.seen < h.raiseCount;
    const canRaise = othersCanAct && reopened && maxTo > h.currentBet;
    const minTo = Math.min(h.currentBet + h.minRaise, maxTo);
    return {
      canCheck: s.bet >= h.currentBet,
      toCall,
      canRaise,
      minTo: canRaise ? minTo : null,
      maxTo: canRaise ? maxTo : null,
      isBet: h.currentBet === 0,
    };
  }

  act(uid, action, auto = false) {
    const h = this.hand;
    if (!h || h.over) fail('There is no hand in progress.');
    if (h.toAct !== uid) fail("It's not your turn.");
    const s = h.ps.get(uid), p = this.players.get(uid);
    const opt = this.options(uid);
    if (!auto) p.timeouts = 0;

    let type = action?.type;
    if (type === 'allin') {
      const maxTo = s.bet + p.stack;
      if (opt.canRaise && maxTo > h.currentBet) { type = 'raise'; action = { type, to: maxTo }; }
      else type = opt.canCheck ? 'check' : 'call';
    }

    switch (type) {
      case 'fold':
        s.folded = true;
        s.last = 'Fold';
        this.addLog(`${p.name} folds`);
        break;
      case 'check':
        if (!opt.canCheck) fail('You need to call or fold.');
        s.last = 'Check';
        this.addLog(`${p.name} checks`);
        break;
      case 'call': {
        if (opt.canCheck) { s.last = 'Check'; this.addLog(`${p.name} checks`); break; }
        const amt = opt.toCall;
        p.stack -= amt; s.bet += amt; s.total += amt;
        if (p.stack === 0) s.allIn = true;
        s.last = s.allIn ? 'All-in' : 'Call';
        this.addLog(`${p.name} calls ${amt}${s.allIn ? ' (all-in)' : ''}`);
        break;
      }
      case 'raise': {
        if (!opt.canRaise) fail("You can't raise here.");
        const to = action.to;
        if (!Number.isInteger(to)) fail('Enter a whole number of chips.');
        if (to > opt.maxTo) fail(`You only have ${opt.maxTo} in total.`);
        if (to < opt.minTo) fail(`The minimum is ${opt.minTo}.`);
        const add = to - s.bet;
        const raiseBy = to - h.currentBet;
        p.stack -= add; s.bet = to; s.total += add;
        if (p.stack === 0) s.allIn = true;
        if (raiseBy >= h.minRaise) { h.minRaise = raiseBy; h.raiseCount++; }
        const wasBet = h.currentBet === 0;
        h.currentBet = to;
        for (const o of h.ps.values()) if (o !== s && !o.folded && !o.allIn) o.acted = false;
        s.last = s.allIn ? 'All-in' : wasBet ? 'Bet' : 'Raise';
        this.addLog(`${p.name} ${wasBet ? 'bets' : 'raises to'} ${to}${s.allIn ? ' (all-in)' : ''}`);
        break;
      }
      default:
        fail('Unknown action.');
    }
    s.acted = true;
    s.voluntary = true;
    s.seen = h.raiseCount;
    this.afterAction();
  }

  afterAction() {
    const h = this.hand;
    if (this.liveStates().length === 1) return this.finishByFold();
    const seat = h.ps.get(h.toAct)?.seat ?? h.buttonSeat;
    const next = this.nextToAct(seat);
    if (next) { this.setTurn(next); this.changed(); return; }
    this.setTurn(null);
    this.endStreet();
  }

  endStreet() {
    const h = this.hand;
    for (const s of h.ps.values()) s.bet = 0;
    h.currentBet = 0;
    this.changed();
    if (h.street === 'river') return this.showdown();
    const runout = this.actorStates().length <= 1;
    if (runout && !h.showAll) h.showAll = true; // all-in: cards go face up, board runs out
    this.later(runout ? this.timings.runout : this.timings.street, () => this.dealStreet());
  }

  dealStreet() {
    const h = this.hand;
    if (!h || h.over) return;
    h.pos++; // burn
    if (h.street === 'preflop') { h.board.push(h.deck[h.pos++], h.deck[h.pos++], h.deck[h.pos++]); h.street = 'flop'; }
    else if (h.street === 'flop') { h.board.push(h.deck[h.pos++]); h.street = 'turn'; }
    else { h.board.push(h.deck[h.pos++]); h.street = 'river'; }
    this.history[this.history.length - 1].board = [...h.board];
    h.minRaise = h.bigBlind;
    for (const s of h.ps.values()) { s.acted = false; s.voluntary = false; s.seen = 0; if (!s.folded && !s.allIn) s.last = null; }
    h.raiseCount = 0;
    const next = this.nextToAct(h.buttonSeat);
    this.setTurn(next);
    this.changed();
    if (!next) this.endStreet();
  }

  finishByFold() {
    const h = this.hand;
    this.setTurn(null);
    const winner = this.liveStates()[0];
    const pot = [...h.ps.values()].reduce((a, s) => a + s.total, 0);
    this.players.get(winner.uid).stack += pot;
    for (const s of h.ps.values()) s.bet = 0;
    const name = this.players.get(winner.uid).name;
    this.addLog(`${name} wins ${pot}`);
    this.finish({ byFold: true, winners: [{ uid: winner.uid, name, amount: pot, hand: null, cards: [] }], pots: [{ amount: pot, winners: [winner.uid] }], shown: {} });
  }

  showdown() {
    const h = this.hand;
    h.street = 'showdown';
    this.setTurn(null);
    const pots = buildPots([...h.ps.values()]);
    const live = this.liveStates();
    const shown = {};
    const best = {};
    for (const s of live) {
      const b = bestFive([...s.cards, ...h.board]);
      best[s.uid] = b;
      shown[s.uid] = { cards: s.cards, hand: describe(b.score), best: b.cards };
    }
    // odd chips go to the first winner left of the button
    const seatRank = (uid) => { const seat = h.ps.get(uid).seat; return (seat - h.buttonSeat - 1 + this.seats.length) % this.seats.length; };
    const won = new Map();
    const potResults = [];
    for (const pot of pots) {
      const top = Math.max(...pot.eligible.map((u) => best[u].score));
      const winners = pot.eligible.filter((u) => best[u].score === top).sort((a, b) => seatRank(a) - seatRank(b));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const u of winners) {
        const amt = share + (odd-- > 0 ? 1 : 0);
        won.set(u, (won.get(u) ?? 0) + amt);
      }
      potResults.push({ amount: pot.amount, winners });
    }
    const winners = [];
    for (const [uid, amount] of won) {
      const p = this.players.get(uid);
      p.stack += amount;
      winners.push({ uid, name: p.name, amount, hand: shown[uid].hand, cards: best[uid].cards });
      this.addLog(`${p.name} wins ${amount} with ${shown[uid].hand}`);
    }
    h.showAll = true;
    this.finish({ byFold: false, winners, pots: potResults, shown });
  }

  finish(result) {
    const h = this.hand;
    h.over = true;
    h.result = result;
    this.lastResult = { no: h.no, ...result };
    const rec = this.history[this.history.length - 1];
    rec.board = [...h.board];
    rec.shown = Object.fromEntries(Object.entries(result.shown).map(([u, v]) => [u, v.cards]));
    rec.winners = result.winners.map((w) => ({ uid: w.uid, amount: w.amount }));
    this.changed();
    this.later(result.byFold ? this.timings.foldWin : this.timings.showdown, () => this.cleanupHand());
  }

  cleanupHand() {
    const ops = this.pendingOps;
    this.pendingOps = [];
    this.hand = null;
    for (const op of ops) this.applyOp(op);
    for (const p of this.players.values()) {
      if (p.leaveAfterHand && p.seat !== null) {
        this.seats[p.seat] = null;
        p.seat = null;
        p.leaveAfterHand = false;
        this.addLog(`${p.name} stood up`);
      }
    }
    if (this.endAfterHand) return this.closeSession();
    this.changed();
    this.maybeStartHand();
  }

  // ---------- views ----------

  addLog(text) {
    this.log.push({ id: ++this.seq, text, at: this.now() });
    if (this.log.length > 80) this.log.shift();
  }

  changed() { this.onChange(this); }

  viewFor(uid) {
    const h = this.hand;
    const me = this.players.get(uid);
    const isHost = this.isHost(uid);
    const seats = this.seats.map((pid, seat) => {
      if (!pid) return { seat, empty: true };
      const p = this.players.get(pid);
      const s = h?.ps.get(pid);
      let cards = null;
      if (s) {
        const reveal = pid === uid || (h.showAll && !s.folded) || (h.result && h.result.shown[pid]);
        cards = reveal ? s.cards : s.folded ? null : [null, null];
      }
      return {
        seat, uid: pid, name: p.name, avatar: p.avatar, stack: p.stack, connected: p.connected,
        sittingOut: p.sittingOut, leaving: p.leaveAfterHand,
        inHand: !!s, folded: s?.folded ?? false, allIn: s?.allIn ?? false,
        bet: s?.bet ?? 0, last: s?.last ?? null, cards,
      };
    });
    let hand = null;
    if (h) {
      const states = [...h.ps.values()];
      const potTotal = states.reduce((a, s) => a + s.total - s.bet, 0);
      hand = {
        no: h.no, street: h.street, board: h.board, buttonSeat: h.buttonSeat, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
        toAct: h.toAct, deadline: h.deadline, currentBet: h.currentBet, commitment: h.commitment,
        pot: potTotal, pots: h.over ? [] : buildPots(states.map((s) => ({ ...s, total: s.total - s.bet }))).map((p) => p.amount),
        result: h.result, over: h.over,
      };
    }
    const myHandName = h && h.ps.get(uid) && !h.ps.get(uid).folded && h.board.length >= 3 ? describe(evaluate([...h.ps.get(uid).cards, ...h.board])) : null;
    return {
      id: this.id, name: this.name, hostId: this.hostId, status: this.status, settings: this.settings,
      serverNow: this.now(),
      seats, hand, buttonSeat: this.buttonSeat,
      me: me ? { uid, seat: me.seat, stack: me.stack, isHost, sittingOut: me.sittingOut, options: this.options(uid), handName: myHandName, pendingRequest: this.requests.find((r) => r.uid === uid) ?? null } : null,
      players: [...this.players.values()].map((p) => ({ uid: p.id, name: p.name, avatar: p.avatar, seat: p.seat, stack: p.stack, connected: p.connected })),
      requests: isHost ? this.requests : [],
      pendingOps: this.pendingOps.map((o) => ({ ...o })),
      bill: this.billSheet(),
      log: this.log.slice(-40),
      fairness: this.history.slice(-30).map((r) => ({ no: r.no, commitment: r.commitment, board: r.board, seed: this.status === 'ended' ? r.seed : null, order: r.order })),
    };
  }

  // seeds for every hand, only once the session is over
  revealedHistory() {
    if (this.status !== 'ended') return [];
    return this.history.map((r) => ({ no: r.no, commitment: r.commitment, seed: r.seed, order: r.order, board: r.board, shown: r.shown ?? {} }));
  }

  // ---------- persistence ----------

  toJSON() {
    const h = this.hand;
    return {
      v: 1, id: this.id, name: this.name, hostId: this.hostId, settings: this.settings,
      status: this.status,
      players: [...this.players.values()].map((p) => ({
        ...p,
        connected: false,
        leaveAfterHand: false,
        // a hand in progress is void after a restart: everyone gets their chips back
        stack: h && !h.over ? h.startStacks[p.id] ?? p.stack : p.stack,
      })),
      seats: this.seats, ledger: { entries: this.ledger.entries, seq: this.ledger.seq },
      requests: this.requests,
      pendingOps: this.pendingOps,
      handNo: this.handNo, buttonSeat: this.buttonSeat,
      history: this.history, log: this.log, seq: this.seq, createdAt: this.createdAt,
    };
  }

  static fromJSON(data, opts = {}) {
    const host = data.players.find((p) => p.id === data.hostId);
    const t = new Table({ ...opts, id: data.id, name: data.name, host, settings: data.settings });
    t.log = [];
    t.players = new Map(data.players.map((p) => [p.id, { ...p }]));
    t.seats = data.seats;
    t.ledger = new Ledger(data.ledger);
    t.requests = data.requests ?? [];
    t.handNo = data.handNo;
    t.buttonSeat = data.buttonSeat;
    t.history = data.history ?? [];
    t.log = data.log ?? [];
    t.seq = data.seq ?? 0;
    t.status = data.status;
    t.createdAt = data.createdAt;
    // a hand interrupted by a restart is void: drop its board from history
    const last = t.history[t.history.length - 1];
    if (last && !last.winners) t.history.pop();
    for (const op of data.pendingOps ?? []) t.applyOp(op);
    return t;
  }
}

export function buildPots(states) {
  const contrib = new Map(states.map((s) => [s.uid, s.total]));
  const pots = [];
  for (;;) {
    const live = states.filter((s) => !s.folded && contrib.get(s.uid) > 0);
    if (!live.length) break;
    const level = Math.min(...live.map((s) => contrib.get(s.uid)));
    let amount = 0;
    for (const s of states) {
      const c = contrib.get(s.uid);
      const take = Math.min(c, level);
      amount += take;
      contrib.set(s.uid, c - take);
    }
    const eligible = live.map((s) => s.uid);
    const prev = pots[pots.length - 1];
    if (prev && prev.eligible.length === eligible.length && prev.eligible.every((u) => eligible.includes(u))) prev.amount += amount;
    else pots.push({ amount, eligible });
  }
  const leftover = [...contrib.values()].reduce((a, b) => a + b, 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
  }
  return pots;
}

function sanitizeSettings(s) {
  const int = (v, min, max, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
  const bigBlind = int(s.bigBlind, 2, 1e9, 10);
  const smallBlind = int(s.smallBlind, 1, bigBlind, Math.floor(bigBlind / 2));
  const tv = Number(s.tokenValue);
  return {
    smallBlind,
    bigBlind,
    tokenValue: Number.isFinite(tv) && tv > 0 ? Math.round(tv * 10000) / 10000 : 1,
    currency: String(s.currency ?? '₹').slice(0, 4) || '₹',
    defaultBuyIn: int(s.defaultBuyIn, bigBlind, 1e12, bigBlind * 100),
    turnSeconds: int(s.turnSeconds, 0, 300, 30),
    autoApproveBuyIns: !!s.autoApproveBuyIns,
    maxSeats: int(s.maxSeats, 2, 10, 9),
  };
}
