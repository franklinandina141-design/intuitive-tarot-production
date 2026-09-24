/**
 * JSON-file ledger with in-process mutex + atomic write (temp + rename).
 * Used for PAY_DEV_MODE / local when DATABASE_URL is unset.
 * Render free disk is ephemeral — production should set DATABASE_URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LEDGER = path.resolve(__dirname, '..', 'data', 'ledger.json');

function emptyLedger() {
  return {
    version: 1,
    users: {},
    sessions: {},
    orders: {},
    notifyHandled: {},
  };
}

export function createJsonStore(options = {}) {
  const ledgerPath = options.ledgerPath || process.env.PAY_LEDGER_PATH || DEFAULT_LEDGER;
  let chain = Promise.resolve();
  let cache = null;

  function ensureDir() {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  }

  function readSync() {
    if (cache) return cache;
    ensureDir();
    if (!fs.existsSync(ledgerPath)) {
      cache = emptyLedger();
      return cache;
    }
    try {
      const raw = fs.readFileSync(ledgerPath, 'utf8');
      cache = { ...emptyLedger(), ...JSON.parse(raw || '{}') };
      cache.users = cache.users || {};
      cache.sessions = cache.sessions || {};
      cache.orders = cache.orders || {};
      cache.notifyHandled = cache.notifyHandled || {};
    } catch {
      cache = emptyLedger();
    }
    return cache;
  }

  function writeSync(data) {
    ensureDir();
    const tmp = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, ledgerPath);
    cache = data;
  }

  /** Serialize mutating operations. */
  function withLock(fn) {
    const run = chain.then(async () => {
      const data = structuredClone(readSync());
      const result = await fn(data);
      writeSync(data);
      return result;
    });
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function peek() {
    return structuredClone(readSync());
  }

  /** Test helper: wipe ledger on disk and memory. */
  function reset() {
    cache = emptyLedger();
    ensureDir();
    writeSync(cache);
  }

  return {
    backend: 'json',
    ledgerPath,
    withLock,
    peek,
    reset,
    readSync,
  };
}
