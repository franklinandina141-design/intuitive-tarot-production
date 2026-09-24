#!/usr/bin/env node
/**
 * Ping the production /health endpoint so Render free-plan services stay warm.
 *
 * Usage:
 *   HEALTH_URL=https://intuitive-tarot-production.onrender.com/health node scripts/keepalive.mjs
 *   # or after proxy:
 *   HEALTH_URL=https://api.witchtable.cn/health node scripts/keepalive.mjs
 *
 * Schedule every ~10 minutes via:
 *   - cron / launchd: run this script on a 10-minute interval
 *   - GitHub Actions scheduled workflow
 *   - external uptime (UptimeRobot / Better Stack / Cron-job.org) GET /health
 *
 * Free Render web services sleep after idle; keepalive reduces cold starts but
 * does not replace a paid always-on plan. See render.yaml comments / docs/launch-checklist.md.
 */
const url = (process.env.HEALTH_URL || process.env.KEEPALIVE_URL || '').trim();

if (!url) {
  console.error('Set HEALTH_URL (e.g. https://intuitive-tarot-production.onrender.com/health)');
  process.exit(2);
}

const started = Date.now();
try {
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'witchtable-keepalive/1.0' },
    signal: AbortSignal.timeout(Number(process.env.KEEPALIVE_TIMEOUT_MS) || 25000),
  });
  const text = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) {
    console.error(`keepalive FAIL ${res.status} ${ms}ms ${url} body=${text.slice(0, 120)}`);
    process.exit(1);
  }
  console.log(`keepalive OK ${res.status} ${ms}ms ${url}`);
} catch (err) {
  console.error(`keepalive ERROR ${url}: ${err.message || err}`);
  process.exit(1);
}
