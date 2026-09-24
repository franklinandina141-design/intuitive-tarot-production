/**
 * Postgres-backed ledger when DATABASE_URL is set.
 * Same interface as store-json: withLock / peek / reset / readSync.
 * Uses a transaction + advisory lock; mutates an in-memory snapshot then writes back
 * so existing routes.mjs keep working unchanged.
 *
 * Dependency: `pg` (optional — only required when DATABASE_URL is set).
 * Render: Dashboard → your web service → Addons → PostgreSQL → copy Internal Database URL
 * into DATABASE_URL (or link the addon so Render injects it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, 'sql', '001_init.sql');
const ADVISORY_LOCK_KEY = 87231401; // arbitrary stable int for pay ledger

function emptyLedger() {
  return {
    version: 1,
    users: {},
    sessions: {},
    orders: {},
    notifyHandled: {},
  };
}

function maskDatabaseUrl(url = '') {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return 'postgres';
  }
}

async function loadPg() {
  try {
    const mod = await import('pg');
    return mod.default || mod;
  } catch (err) {
    const e = new Error(
      'DATABASE_URL is set but the `pg` package is not installed. Run: npm install pg'
    );
    e.cause = err;
    throw e;
  }
}

export function createPgStore(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
  if (!databaseUrl) {
    throw new Error('createPgStore requires DATABASE_URL or options.databaseUrl');
  }

  let pool = null;
  let ready = null;
  let chain = Promise.resolve();

  async function getPool() {
    if (pool) return pool;
    const pg = await loadPg();
    pool = new pg.Pool({
      connectionString: databaseUrl,
      // Render external URL needs SSL; internal usually does too in practice
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PAY_PG_POOL_MAX) || 4,
    });
    return pool;
  }

  async function ensureReady() {
    if (ready) return ready;
    ready = (async () => {
      const p = await getPool();
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      await p.query(sql);
    })();
    return ready;
  }

  async function loadSnapshot(client) {
    const data = emptyLedger();
    const users = await client.query(
      'SELECT openid, credits, free_granted, created_at, updated_at FROM pay_users'
    );
    for (const row of users.rows) {
      data.users[row.openid] = {
        openid: row.openid,
        credits: Number(row.credits) || 0,
        freeGranted: Number(row.free_granted) || 0,
        createdAt: Number(row.created_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
      };
    }

    const sessions = await client.query('SELECT token, openid, created_at FROM pay_sessions');
    for (const row of sessions.rows) {
      data.sessions[row.token] = {
        openid: row.openid,
        createdAt: Number(row.created_at) || 0,
      };
    }

    const orders = await client.query(
      `SELECT order_id, openid, product_id, price_fen, credits, status, created_at, paid_at
       FROM pay_orders`
    );
    for (const row of orders.rows) {
      data.orders[row.order_id] = {
        orderId: row.order_id,
        openid: row.openid,
        productId: row.product_id,
        priceFen: Number(row.price_fen) || 0,
        credits: Number(row.credits) || 0,
        status: row.status || 'pending',
        createdAt: Number(row.created_at) || 0,
        paidAt: row.paid_at == null ? null : Number(row.paid_at),
      };
    }

    const notifies = await client.query('SELECT order_id, at, source FROM pay_notify_handled');
    for (const row of notifies.rows) {
      data.notifyHandled[row.order_id] = {
        at: Number(row.at) || 0,
        source: row.source || '',
      };
    }

    return data;
  }

  async function saveSnapshot(client, data) {
    // Full replace within the transaction (small ledger; simple + correct).
    await client.query('DELETE FROM pay_notify_handled');
    await client.query('DELETE FROM pay_orders');
    await client.query('DELETE FROM pay_sessions');
    await client.query('DELETE FROM pay_users');

    for (const user of Object.values(data.users || {})) {
      await client.query(
        `INSERT INTO pay_users(openid, credits, free_granted, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.openid,
          Number(user.credits) || 0,
          Number(user.freeGranted) || 0,
          Number(user.createdAt) || Date.now(),
          Number(user.updatedAt) || Date.now(),
        ]
      );
    }

    for (const [token, sess] of Object.entries(data.sessions || {})) {
      await client.query(
        `INSERT INTO pay_sessions(token, openid, created_at) VALUES ($1, $2, $3)`,
        [token, sess.openid, Number(sess.createdAt) || Date.now()]
      );
    }

    for (const order of Object.values(data.orders || {})) {
      await client.query(
        `INSERT INTO pay_orders(
           order_id, openid, product_id, price_fen, credits, status, created_at, paid_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          order.orderId,
          order.openid,
          order.productId,
          Number(order.priceFen) || 0,
          Number(order.credits) || 0,
          order.status || 'pending',
          Number(order.createdAt) || Date.now(),
          order.paidAt == null ? null : Number(order.paidAt),
        ]
      );
    }

    for (const [orderId, handled] of Object.entries(data.notifyHandled || {})) {
      await client.query(
        `INSERT INTO pay_notify_handled(order_id, at, source) VALUES ($1, $2, $3)`,
        [orderId, Number(handled.at) || Date.now(), handled.source || '']
      );
    }
  }

  function withLock(fn) {
    const run = chain.then(async () => {
      await ensureReady();
      const p = await getPool();
      const client = await p.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
        const data = await loadSnapshot(client);
        const result = await fn(data);
        await saveSnapshot(client, data);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    });
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function peek() {
    await ensureReady();
    const p = await getPool();
    const client = await p.connect();
    try {
      return await loadSnapshot(client);
    } finally {
      client.release();
    }
  }

  /** Sync peek for callers that still use readSync — loads via blocking is not available;
   *  returns last cached empty if never peeked. Prefer peek()/withLock. */
  let lastPeek = emptyLedger();
  async function refreshPeekCache() {
    lastPeek = await peek();
    return lastPeek;
  }

  function readSync() {
    return structuredClone(lastPeek);
  }

  async function reset() {
    await ensureReady();
    const p = await getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
      await client.query('DELETE FROM pay_notify_handled');
      await client.query('DELETE FROM pay_orders');
      await client.query('DELETE FROM pay_sessions');
      await client.query('DELETE FROM pay_users');
      await client.query('COMMIT');
      lastPeek = emptyLedger();
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function close() {
    if (pool) {
      await pool.end();
      pool = null;
      ready = null;
    }
  }

  // Warm schema in background (errors surface on first withLock/peek).
  ensureReady().catch(() => {});

  return {
    backend: 'postgres',
    ledgerPath: maskDatabaseUrl(databaseUrl),
    withLock,
    peek,
    reset,
    readSync,
    refreshPeekCache,
    close,
    ensureReady,
  };
}
