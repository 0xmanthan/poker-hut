# Poker Hut

No-limit Texas Hold'em for your home game. No accounts (pick a name and play), a host who approves buy-ins,
a live bill sheet (buy-ins, loans between players, who pays whom), and a provably fair deal.

Runs free on Cloudflare Workers + Durable Objects (one Durable Object per table, state saved
in its built-in SQLite storage, so tables survive restarts).

## Run it locally

```bash
npm install
npm run dev          # worker on :8787, app on http://localhost:5173
npm test             # engine tests (rules, side pots, bill sheet, exhaustive hand counts)
npm run fairness     # deal 200k hands and compare with exact poker odds
```

`.dev.vars` holds the local `SESSION_SECRET`.
It is git-ignored; create it if missing:

```
SESSION_SECRET=<any long random string>
```

## Players

There are no accounts. Entering a name gives the browser a signed token with a random player id,
so reloading keeps your seat and chips. A different browser or device is a different player.

## Put it online (free)

```bash
npx wrangler login                    # opens the browser, log in to Cloudflare (free account)
npx wrangler secret put SESSION_SECRET   # paste a long random string
npm run deploy                        # builds the app and deploys
```

Wrangler prints the URL (`https://poker-hut.<subdomain>.workers.dev`).

Free-plan limits (Cloudflare, checked Oct 2026): 100,000 Durable Object requests/day,
13,000 GB-s of Durable Object time/day (about 28 hours of one table being open), 5 GB storage.
A friends' game uses a small fraction of that.

## Where data lives

- **Live table** (seats, stacks, bill sheet, shuffle seeds): that table's Durable Object, in its built-in SQLite storage.
- **D1 database `poker-hut`** (`migrations/`): players, tables each person joined, and every player's final
  result when a session ends. Powers "Your tables" and "Standings" in the lobby.
  Apply new migrations with `npm run db:migrate` (remote) or `npm run db:migrate:local`.

## How the deal stays fair

- Each hand gets a fresh 256-bit seed from the OS cryptographic RNG.
- The deck comes from that seed via HMAC-SHA256 and an unbiased Fisher–Yates shuffle
  (`engine/deck.js`). One 52-card deck, dealt in order, burn cards included.
- There is no weighting, no "action" logic and no memory between hands.
- Before the first card, the table shows `sha256(seed)`. Browsers save these fingerprints.
  When the host ends the session the seeds are revealed, and the Fairness tab rebuilds every
  deck in the browser and checks the board and shown hands match.

## Layout

```
engine/   pure game logic (deck, evaluator, table rules, bill sheet) — tested with node:test
worker/   Cloudflare Worker: auth, table creation, TableRoom Durable Object (websockets)
client/   React app (Vite)
scripts/  fairness simulation
test/     engine tests
```
