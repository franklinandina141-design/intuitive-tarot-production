/**
 * Pay ledger factory.
 * - DATABASE_URL set → Postgres (durable; use Render Postgres addon)
 * - otherwise → JSON file (PAY_DEV_MODE / local; ephemeral on Render free disk)
 *
 * Force JSON: pass { backend: 'json' } or { ledgerPath } (tests / local override).
 *
 * Interface (both backends):
 *   { backend, ledgerPath, withLock, peek, reset, readSync }
 */
import { createJsonStore } from './store-json.mjs';
import { createPgStore } from './store-pg.mjs';

export function createStore(options = {}) {
  const forceJson = options.backend === 'json' || Boolean(options.ledgerPath);
  const databaseUrl =
    options.databaseUrl ||
    (!forceJson && options.backend !== 'json' ? process.env.DATABASE_URL : '') ||
    '';
  if (databaseUrl && options.backend !== 'json') {
    return createPgStore({ ...options, databaseUrl });
  }
  return createJsonStore(options);
}

export { createJsonStore } from './store-json.mjs';
export { createPgStore } from './store-pg.mjs';
