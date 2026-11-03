// ---------- session & API ----------

const TOKEN_KEY = 'ph_token';
const USER_KEY = 'ph_user';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export const session = {
  token: () => store.get(TOKEN_KEY),
  user: () => { try { return store.get(TOKEN_KEY) ? JSON.parse(store.get(USER_KEY)) : null; } catch { return null; } },
  save(token, user) { store.set(TOKEN_KEY, token); store.set(USER_KEY, JSON.stringify(user)); },
  clear() { store.set(TOKEN_KEY, null); store.set(USER_KEY, null); },
};

// The game server (Cloudflare Worker). Empty = same origin, as in local dev.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export const wsUrl = (path) => {
  const base = API_BASE || location.origin;
  return base.replace(/^http/, 'ws') + path;
};

export async function api(path, body) {
  const token = session.token();
  const res = await fetch(API_BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

// ---------- cards ----------

export const RANKS = '23456789TJQKA';
export const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];
export const rankOf = (c) => c >> 2;
export const suitOf = (c) => c & 3;
export const rankLabel = (c) => { const r = RANKS[rankOf(c)]; return r === 'T' ? '10' : r; };
export const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;
export const cardName = (c) => `${rankLabel(c)}${SUIT_GLYPHS[suitOf(c)]}`;

// ---------- money ----------

export function money(chips, settings) {
  const v = Math.round(chips * settings.tokenValue * 100) / 100;
  const abs = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}${settings.currency}${abs}`;
}

export const chips = (n) => Number(n).toLocaleString('en-IN');

// ---------- sound (tiny synthesized cues, no files) ----------

let ctx = null;
let muted = store.get('ph_muted') === '1';
export const sound = {
  get muted() { return muted; },
  toggle() { muted = !muted; store.set('ph_muted', muted ? '1' : '0'); return muted; },
  play(kind) {
    if (muted) return;
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.connect(ctx.destination);
      // short shaped noise burst through a filter
      const noise = (at, len, type, freq, q, gain) => {
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const f = ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        const ng = ctx.createGain();
        ng.gain.value = gain;
        src.connect(f); f.connect(ng); ng.connect(ctx.destination);
        src.start(at);
      };
      const tone = (at, freq, to, len, gain, type = 'sine') => {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, at);
        if (to) o.frequency.exponentialRampToValueAtTime(to, at + len);
        og.gain.setValueAtTime(0.0001, at);
        og.gain.exponentialRampToValueAtTime(gain, at + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(og); og.connect(ctx.destination);
        o.start(at); o.stop(at + len + 0.02);
      };
      if (kind === 'card') {
        // a clean flick: brief, bright, quiet
        noise(t, 0.035, 'highpass', 3200, 0.7, 0.16);
      } else if (kind === 'chip') {
        // one small coin clink: two inharmonic partials, a hair apart
        tone(t, 4200, 0, 0.07, 0.035);
        tone(t + 0.028, 6100, 0, 0.05, 0.022);
      } else if (kind === 'check') {
        // two soft knocks on the table
        for (const dt of [0, 0.12]) {
          tone(t + dt, 150, 70, 0.11, 0.2);
          noise(t + dt, 0.03, 'lowpass', 500, 0.7, 0.12);
        }
      } else if (kind === 'turn') {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(660, t);
        o.frequency.setValueAtTime(880, t + 0.09);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); o.start(t); o.stop(t + 0.32);
      } else if (kind === 'win') {
        [523, 659, 784].forEach((freq, i) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'sine'; o.frequency.value = freq;
          og.gain.setValueAtTime(0.0001, t + i * 0.08);
          og.gain.exponentialRampToValueAtTime(0.12, t + i * 0.08 + 0.01);
          og.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.4);
          o.connect(og); og.connect(ctx.destination);
          o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.45);
        });
      }
    } catch { /* audio unavailable */ }
  },
};

// ---------- fairness verification (runs entirely in the browser) ----------

const hexToBytes = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
const bytesToHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(seedHex) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', hexToBytes(seedHex)));
}

// Mirrors engine/deck.js exactly (36 cards, sixes up, for short deck).
export async function deckFromSeed(seedHex, variant = 'nlhe') {
  const key = await crypto.subtle.importKey('raw', hexToBytes(seedHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const enc = new TextEncoder();
  let block = 0;
  let words = [];
  const nextU32 = async () => {
    if (!words.length) {
      const buf = new DataView(await crypto.subtle.sign('HMAC', key, enc.encode(`poker-hut:${block++}`)));
      for (let i = 0; i < 32; i += 4) words.push(buf.getUint32(i));
    }
    return words.shift();
  };
  const rand = async (n) => {
    const limit = Math.floor(0x100000000 / n) * n;
    let v;
    do v = await nextU32(); while (v >= limit);
    return v % n;
  };
  const deck = variant === 'shortdeck' ? Array.from({ length: 36 }, (_, i) => i + 16) : Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = await rand(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Commitments and my own cards, saved as I see them during play, so the
// server can't rewrite them later.
export const witness = {
  key: (code) => `ph_witness_${code}`,
  load(code) { try { return JSON.parse(store.get(this.key(code))) ?? {}; } catch { return {}; } },
  record(code, no, data) {
    const all = this.load(code);
    all[no] = { ...all[no], ...data };
    const keys = Object.keys(all).map(Number).sort((a, b) => a - b);
    while (keys.length > 1200) delete all[keys.shift()];
    store.set(this.key(code), JSON.stringify(all));
  },
};

export async function verifyHand(rec, seen, myUid) {
  const checks = [];
  const hash = await sha256Hex(rec.seed);
  checks.push({ label: 'Seed matches the fingerprint published before the deal', ok: hash === rec.commitment });
  if (seen?.commitment) checks.push({ label: 'Fingerprint matches what your browser saw live', ok: seen.commitment === rec.commitment });
  const deck = await deckFromSeed(rec.seed, rec.variant);
  const n = rec.order.length;
  const holes = Object.fromEntries(rec.order.map((uid, i) => [uid, [deck[i], deck[i + n]]]));
  let p = 2 * n;
  const full = [];
  p++; full.push(deck[p++], deck[p++], deck[p++]);
  p++; full.push(deck[p++]);
  p++; full.push(deck[p++]);
  const board = full.slice(0, rec.board.length);
  checks.push({ label: 'Board came off the top of that deck', ok: JSON.stringify(board) === JSON.stringify(rec.board) });
  if (rec.board2) {
    // run it twice: the second board keeps the shared cards, then continues from the same deck
    let shared = 0;
    while (shared < 5 && rec.board2[shared] === rec.board[shared]) shared++;
    const second = rec.board2.slice(0, shared);
    while (second.length < 5) { p++; const n = second.length === 0 ? 3 : 1; for (let i = 0; i < n; i++) second.push(deck[p++]); }
    checks.push({ label: 'Second run came off the same deck', ok: JSON.stringify(second) === JSON.stringify(rec.board2) });
  }
  for (const [uid, cards] of Object.entries(rec.shown ?? {})) {
    checks.push({ label: 'Shown hand matches the deck', ok: JSON.stringify(holes[uid]) === JSON.stringify(cards) });
  }
  if (seen?.mine && holes[myUid]) checks.push({ label: 'Your hole cards match the deck', ok: JSON.stringify(holes[myUid]) === JSON.stringify(seen.mine) });
  return { ok: checks.every((c) => c.ok), checks, holes, board };
}
