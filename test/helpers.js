import { Table } from '../engine/table.js';
import { stringToCard } from '../engine/deck.js';

export const c = (s) => stringToCard(s);
export const cs = (str) => str.split(' ').filter(Boolean).map(c);

// Build a deck that deals `holes` (one entry per player in dealing order) and `board`.
export function stackedDeck(holes, board) {
  const n = holes.length;
  const order = [];
  for (let r = 0; r < 2; r++) for (let i = 0; i < n; i++) order.push(holes[i][r]);
  const b = board.split(' ');
  const used = new Set([...order, ...b]);
  const rest = [];
  for (let i = 0; i < 52; i++) if (![...used].map(c).includes(i)) rest.push(i);
  const take = () => rest.shift();
  const deck = [...order.map(c), take(), c(b[0]), c(b[1]), c(b[2]), take(), c(b[3]), take(), c(b[4]), ...rest];
  return deck;
}

// A table whose timers run only when the test says so.
export function makeTable({ players = 3, stacks, settings = {}, decks = [] } = {}) {
  const queue = [];
  const host = { id: 'p0', name: 'P0' };
  let deckIdx = 0;
  const t = new Table({
    id: 'T', name: 'Test', host,
    settings: { smallBlind: 5, bigBlind: 10, turnSeconds: 0, autoApproveBuyIns: true, ...settings },
    schedule: (fn) => { const h = { fn, dead: false }; queue.push(h); return h; },
    clear: (h) => { if (h) h.dead = true; },
    shuffle: decks.length ? () => ({ seed: '00'.repeat(32), deck: decks[deckIdx++ % decks.length] }) : undefined,
  });
  for (let i = 0; i < players; i++) {
    const id = `p${i}`;
    t.join({ id, name: `P${i}` });
    t.sit(id, i);
    t.requestBuyIn(id, stacks ? stacks[i] : 1000);
  }
  const flush = (max = 50) => {
    let n = 0;
    while (queue.length && n++ < max) {
      const h = queue.shift();
      if (!h.dead) h.fn();
    }
  };
  // run timers until a decision is needed or the hand is over
  const settle = () => {
    for (let i = 0; i < 50; i++) {
      if (t.hand && !t.hand.over && t.hand.toAct) return;
      if (!queue.some((h) => !h.dead)) return;
      const h = queue.shift();
      if (!h.dead) h.fn();
    }
  };
  // run until the current hand is finished (but don't start the next one)
  const finishHand = () => {
    for (let i = 0; i < 50; i++) {
      if (!t.hand || t.hand.over) return;
      const h = queue.shift();
      if (!h) return;
      if (!h.dead) h.fn();
    }
  };
  return { t, queue, flush, settle, finishHand };
}

export const totalChips = (t) => {
  let sum = [...t.players.values()].reduce((a, p) => a + p.stack, 0);
  if (t.hand && !t.hand.over) for (const s of t.hand.ps.values()) sum += s.total;
  return sum;
};
