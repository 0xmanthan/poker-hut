// Cloudflare Worker: name-only sessions, table creation, and one Durable Object per table.
// Each table lives in its own Durable Object, so its state survives restarts and
// every player at that table talks to the same single instance.

import { DurableObject } from 'cloudflare:workers';
import { SignJWT, jwtVerify } from 'jose';
import { Table, GameError } from '../engine/table.js';
import { saveUser, saveTable, saveMembership, saveResults, myTables, standings } from './db.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// The frontend may live on another origin (Vercel). Sessions are a bearer token, not a
// cookie, so allowing any origin to call the API is safe.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });
const error = (message, status = 400) => json({ error: message }, status);

const secretKey = (env) => {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(env.SESSION_SECRET);
};

async function issueSession(env, user) {
  return new SignJWT({ name: user.name, avatar: user.avatar ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(secretKey(env));
}

async function readSession(env, token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(env), { algorithms: ['HS256'] });
    return { id: payload.sub, name: payload.name, avatar: payload.avatar ?? null };
  } catch {
    return null;
  }
}

const bearer = (req) => (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || null;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const cleanCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS' && path.startsWith('/api/')) return new Response(null, { status: 204, headers: CORS });

    try {
      // No accounts. A name gets you a signed token with a random player id; the browser
      // keeps it, so a reload brings you back to the same seat and chips.
      if (path === '/api/auth/guest' && req.method === 'POST') {
        const { name } = await req.json();
        const clean = String(name ?? '').trim().slice(0, 24);
        if (!clean) return error('Enter a name.');
        const user = { id: `guest:${crypto.randomUUID()}`, name: clean, avatar: null };
        await saveUser(env.DB, user);
        return json({ token: await issueSession(env, user), user });
      }

      // keep the same player id, change the display name
      if (path === '/api/auth/rename' && req.method === 'POST') {
        const current = await readSession(env, bearer(req));
        if (!current) return error('Enter your name first.', 401);
        const { name } = await req.json();
        const clean = String(name ?? '').trim().slice(0, 24);
        if (!clean) return error('Enter a name.');
        const user = { ...current, name: clean };
        await saveUser(env.DB, user);
        return json({ token: await issueSession(env, user), user });
      }

      if (path === '/api/me') {
        const user = await readSession(env, bearer(req));
        return user ? json({ user }) : error('Signed out', 401);
      }

      if (path === '/api/me/history') {
        const user = await readSession(env, bearer(req));
        if (!user) return error('Enter your name first.', 401);
        const [tables, board] = await Promise.all([myTables(env.DB, user.id), standings(env.DB, user.id)]);
        return json({ tables, standings: board });
      }

      if (path === '/api/tables' && req.method === 'POST') {
        const user = await readSession(env, bearer(req));
        if (!user) return error('Enter your name first.', 401);
        const body = await req.json();
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = newCode();
          const stub = env.TABLES.get(env.TABLES.idFromName(code));
          const res = await stub.fetch('https://table/init', {
            method: 'POST',
            body: JSON.stringify({ code, name: String(body.name ?? '').trim().slice(0, 40) || `${user.name}'s table`, host: user, settings: body.settings ?? {} }),
          });
          if (res.status === 409) continue;
          return res.ok ? json({ code }) : error('Could not create a table. Try again.', 500);
        }
        return error('Could not create a table. Try again.', 500);
      }

      const info = path.match(/^\/api\/tables\/([A-Za-z0-9]+)$/);
      if (info) {
        const stub = env.TABLES.get(env.TABLES.idFromName(cleanCode(info[1])));
        const res = await stub.fetch('https://table/info');
        return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', ...CORS } });
      }

      const ws = path.match(/^\/ws\/([A-Za-z0-9]+)$/);
      if (ws) {
        if (req.headers.get('upgrade') !== 'websocket') return error('Expected a websocket', 426);
        const user = await readSession(env, url.searchParams.get('token'));
        if (!user) return error('Enter your name first.', 401);
        const stub = env.TABLES.get(env.TABLES.idFromName(cleanCode(ws[1])));
        const headers = new Headers(req.headers);
        headers.set('x-user', JSON.stringify(user));
        return stub.fetch(new Request('https://table/ws', { headers }));
      }

      if (path.startsWith('/api/')) return error('Not found', 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return error('Something went wrong on the server.', 500);
    }
  },
};

export class TableRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.table = null;
    this.sockets = new Set(); // { ws, user }
    this.chat = [];
    this.broadcastQueued = false;
    this.saveTimer = null;
    this.members = new Set(); // users already recorded in D1 for this table
    this.lastStatus = null;
    ctx.blockConcurrencyWhile(async () => {
      const data = await ctx.storage.get('table');
      if (data) {
        this.table = Table.fromJSON(data, this.hooks());
        this.table.maybeStartHand();
      }
    });
  }

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/init') {
      if (this.table) return error('exists', 409);
      const { code, name, host, settings } = await req.json();
      this.table = new Table({ id: code, name, host, settings, ...this.hooks() });
      this.table.setConnected(host.id, false);
      await this.save();
      await saveTable(this.env.DB, this.table);
      await saveMembership(this.env.DB, code, host.id);
      return json({ code });
    }

    if (url.pathname === '/info') {
      if (!this.table) return error('No table with that code. Check the code and try again.', 404);
      const t = this.table;
      return json({ code: t.id, name: t.name, status: t.status, players: t.seats.filter(Boolean).length, maxSeats: t.seats.length, settings: t.settings });
    }

    if (url.pathname === '/ws') {
      if (!this.table) return error('No table with that code.', 404);
      const user = JSON.parse(req.headers.get('x-user'));
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const session = { ws: server, user };
      this.sockets.add(session);
      this.table.join(user);
      if (!this.members.has(user.id)) {
        // first sight of this player since the object woke: make sure D1 knows the table (older
        // tables predate D1) and that this player sat at it
        const first = this.members.size === 0;
        this.members.add(user.id);
        this.ctx.waitUntil((async () => {
          if (first) await saveTable(this.env.DB, this.table);
          await Promise.all([saveUser(this.env.DB, user), saveMembership(this.env.DB, this.table.id, user.id)]);
        })());
      }
      this.send(session, { type: 'chat', messages: this.chat });
      this.sendState(session);
      server.addEventListener('message', (ev) => this.onMessage(session, ev.data));
      const closed = () => {
        if (!this.sockets.delete(session)) return;
        const stillHere = [...this.sockets].some((s) => s.user.id === user.id);
        if (!stillHere) this.table.setConnected(user.id, false);
      };
      server.addEventListener('close', closed);
      server.addEventListener('error', closed);
      return new Response(null, { status: 101, webSocket: client });
    }

    return error('Not found', 404);
  }

  onMessage(session, raw) {
    if (typeof raw !== 'string' || raw.length > 4000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const t = this.table;
    const uid = session.user.id;
    try {
      switch (msg.type) {
        case 'ping': return this.send(session, { type: 'pong', t: msg.t, serverNow: Date.now() });
        case 'sit': return t.sit(uid, msg.seat);
        case 'stand': return t.standUp(uid);
        case 'sitout': return t.setSittingOut(uid, !!msg.value);
        case 'act': return t.act(uid, msg.action);
        case 'buyin': return t.requestBuyIn(uid, msg.amount);
        case 'resolve': return t.resolveRequest(uid, msg.id, !!msg.approve, msg.amount);
        case 'hostBuyIn': return t.hostBuyIn(uid, msg.uid, msg.amount);
        case 'transfer': return t.transfer(uid, msg.from, msg.to, msg.amount);
        case 'settings': return t.updateSettings(uid, msg.patch ?? {});
        case 'start': return t.start(uid);
        case 'pause': return t.pause(uid);
        case 'end': return t.endSession(uid);
        case 'forceFold': return t.forceFold(uid);
        case 'removeFromSeat': return t.removeFromSeat(uid, msg.uid);
        case 'history': return this.send(session, { type: 'history', hands: t.revealedHistory() });
        case 'chat': {
          const text = String(msg.text ?? '').trim().slice(0, 200);
          if (!text) return;
          const m = { id: crypto.randomUUID(), uid, name: session.user.name, text, at: Date.now() };
          this.chat.push(m);
          if (this.chat.length > 50) this.chat.shift();
          for (const s of this.sockets) this.send(s, { type: 'chat', messages: [m], append: true });
          return;
        }
        default: return;
      }
    } catch (e) {
      if (e instanceof GameError) this.send(session, { type: 'error', message: e.message });
      else { console.error(e); this.send(session, { type: 'error', message: 'Something went wrong. Try again.' }); }
    }
  }

  hooks() {
    return {
      onChange: () => this.changed(),
      onSessionEnd: (t) => this.ctx.waitUntil(saveResults(this.env.DB, t)),
    };
  }

  changed() {
    // keep the D1 row's status in step (waiting -> running)
    const status = this.table?.status;
    if (status && status !== this.lastStatus && status !== 'ended') {
      if (this.lastStatus !== null) this.ctx.waitUntil(saveTable(this.env.DB, this.table));
      this.lastStatus = status;
    }
    if (!this.broadcastQueued) {
      this.broadcastQueued = true;
      queueMicrotask(() => {
        this.broadcastQueued = false;
        for (const s of this.sockets) this.sendState(s);
      });
    }
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
  }

  async save() {
    await this.ctx.storage.put('table', this.table.toJSON());
  }

  sendState(session) {
    this.send(session, { type: 'state', state: this.table.viewFor(session.user.id) });
  }

  send(session, msg) {
    try { session.ws.send(JSON.stringify(msg)); } catch { /* socket already closed */ }
  }
}
