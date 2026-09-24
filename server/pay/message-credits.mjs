/**
 * Credit gate for POST /v1/messages.
 *
 * Authenticated follow-up (same reading session) must not deduct an extra credit.
 * Signal (either is enough) + valid session:
 *   - header X-Reading-Follow-Up: 1
 *   - body.metadata.followUp === true
 * Abuse is bounded by the existing daily rate limit on /v1/messages.
 * Do not rely on omitting the auth header (anonymous) as the long-term design.
 */

function truthyFlag(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

/**
 * @param {import('node:http').IncomingMessage | { headers?: Record<string, string> }} req
 * @param {object | null} [parsedBody]
 */
export function isReadingFollowUp(req, parsedBody = null) {
  const headers = req?.headers || {};
  if (truthyFlag(headers['x-reading-follow-up'])) return true;
  if (parsedBody && typeof parsedBody === 'object' && truthyFlag(parsedBody.metadata?.followUp)) {
    return true;
  }
  return false;
}

/**
 * Decide how /v1/messages should treat credits for this request.
 * @returns {{ action: 'unauthorized' | 'anonymous' | 'skip_deduct' | 'deduct' }}
 */
export function planMessageCredits({ sess, requireCredits, req, parsedBody }) {
  if (requireCredits && !sess) {
    return { action: 'unauthorized' };
  }
  if (!sess) {
    return { action: 'anonymous' };
  }
  if (isReadingFollowUp(req, parsedBody)) {
    return { action: 'skip_deduct' };
  }
  return { action: 'deduct' };
}
