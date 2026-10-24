// D1: records that outlive one table (players, tables, final bill sheets).
// Every write is best-effort: a database hiccup must never stop a hand of poker.

const now = () => Date.now();

async function safely(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`D1 ${label} failed`, e);
    return null;
  }
}

export const saveUser = (db, user) =>
  safely('saveUser', () =>
    db.prepare(
      `INSERT INTO users (id, name, avatar, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (id) DO UPDATE SET name = ?2, avatar = ?3, last_seen = ?4`,
    ).bind(user.id, user.name, user.avatar ?? null, now()).run());

export const saveTable = (db, t) =>
  safely('saveTable', () =>
    db.prepare(
      `INSERT INTO tables (code, name, host_id, status, currency, token_value, small_blind, big_blind, hands, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (code) DO UPDATE SET name = ?2, status = ?4, currency = ?5, token_value = ?6, small_blind = ?7, big_blind = ?8, hands = ?9`,
    ).bind(t.id, t.name, t.hostId, t.status === 'paused' ? 'running' : t.status, t.settings.currency, t.settings.tokenValue,
      t.settings.smallBlind, t.settings.bigBlind, t.handNo, t.createdAt).run());

export const saveMembership = (db, code, userId) =>
  safely('saveMembership', () =>
    db.prepare(`INSERT INTO table_players (code, user_id, joined_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING`)
      .bind(code, userId, now()).run());

// final bill sheet, written once when the host ends the session
export async function saveResults(db, t) {
  const at = now();
  const { rows } = t.billSheet();
  const stmts = [
    db.prepare(`UPDATE tables SET status = 'ended', ended_at = ?2, hands = ?3, currency = ?4, token_value = ?5 WHERE code = ?1`)
      .bind(t.id, at, t.handNo, t.settings.currency, t.settings.tokenValue),
    ...rows.map((r) =>
      db.prepare(
        `INSERT INTO results (code, user_id, name, bought_in, lent, borrowed, final_stack, net_chips, net_money, currency, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (code, user_id) DO UPDATE SET final_stack = ?7, net_chips = ?8, net_money = ?9`,
      ).bind(t.id, r.uid, r.name, r.boughtIn, r.lent, r.borrowed, r.stack, r.net, r.money, t.settings.currency, at)),
  ];
  return safely('saveResults', () => db.batch(stmts));
}

// tables I've sat at, newest first, with my result when the session is over
export async function myTables(db, userId) {
  const { results } = await db.prepare(
    `SELECT t.code, t.name, t.status, t.host_id = ?1 AS is_host, t.currency, t.hands, t.created_at, t.ended_at,
            r.net_money, r.net_chips
       FROM table_players p
       JOIN tables t ON t.code = p.code
       LEFT JOIN results r ON r.code = p.code AND r.user_id = ?1
      WHERE p.user_id = ?1
      ORDER BY t.created_at DESC
      LIMIT 30`,
  ).bind(userId).all();
  return results;
}

// running totals for everyone across the finished sessions I played in
export async function standings(db, userId) {
  const { results } = await db.prepare(
    `SELECT r.user_id, u.name, u.avatar, r.currency, ROUND(SUM(r.net_money), 2) AS net_money, COUNT(*) AS sessions
       FROM results r
       JOIN users u ON u.id = r.user_id
      WHERE r.code IN (SELECT code FROM results WHERE user_id = ?1)
      GROUP BY r.user_id, r.currency
      ORDER BY net_money DESC
      LIMIT 50`,
  ).bind(userId).all();
  return results;
}
