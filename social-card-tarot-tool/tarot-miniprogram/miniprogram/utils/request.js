const {readingEndpoint} = require('../config');
const {buildRequest, buildFollowUpRequest} = require('./reflection');
const {parseReadingResponse} = require('./parse');
const {authHeader, getToken, consumeCredit, refundCredit} = require('./auth');
const {DEFAULT_SPREAD} = require('./deck');

function postMessages(wxApi, data, cards, {useAuth = true, useClientCredit = false, followUp = false} = {}) {
  let settled = false, rejectPending, task;
  const headers = {'content-type': 'application/json'};
  if (useAuth) Object.assign(headers, authHeader());
  if (followUp) headers['X-Reading-Follow-Up'] = '1';
  const willClientCredit = useClientCredit === true && useAuth && Boolean(getToken());

  const promise = new Promise((resolve, reject) => {
    rejectPending = reject;
    function fail(message) {if (!settled) {settled = true; reject(new Error(message));}}

    function startRequest() {
      task = wxApi.request({
        url: readingEndpoint,
        method: 'POST',
        data,
        dataType: 'text',
        responseType: 'text',
        timeout: 60000,
        header: headers,
        success(res) {
          if (settled) return;
          if (res.statusCode !== 200) {
            if (willClientCredit) refundCredit(1).catch(() => {});
            fail(res.statusCode === 429 ? '公开体验额度暂时用完，请稍后再试。' : res.statusCode === 402 ? '次数用完了给小女巫续一杯再来吧' : '解读服务暂时不可用，请稍后重试。');
            return;
          }
          try {
            const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            if (raw.length > 100000) throw new Error('解读内容过长，请重试。');
            const result = parseReadingResponse(raw, cards);
            settled = true;
            resolve(result);
          } catch (error) {
            if (willClientCredit) refundCredit(1).catch(() => {});
            fail(error.message);
          }
        },
        fail() {
          if (willClientCredit) refundCredit(1).catch(() => {});
          fail('暂时连接不上解读服务，请检查网络后重试。');
        }
      });
    }

    if (willClientCredit) {
      consumeCredit(1).then(startRequest).catch((err) => fail(err.message || '次数不足'));
    } else {
      startRequest();
    }
  });

  return {
    promise,
    abort() {
      if (!settled) {
        settled = true;
        rejectPending(new Error('已取消本次等待。'));
        if (task) task.abort();
      }
    }
  };
}

/**
 * Request AI reading. When a session token exists, optionally coordinate
 * client-side consume/refund (server also deducts when token is sent on /v1/messages).
 * Set options.clientCredit=true to call /v1/credits/consume around the reading
 * instead of relying on server-side deduct (useful if REQUIRE_CREDITS_FOR_MESSAGES is off
 * and messages proxy should stay anonymous-compatible).
 */
function requestReading(wxApi, cards, question, options = {}) {
  const spreadId = options.spreadId || DEFAULT_SPREAD;
  const data = buildRequest(cards, question, spreadId);
  return postMessages(wxApi, data, cards, {
    useAuth: options.useAuth !== false,
    useClientCredit: options.clientCredit === true
  });
}

/**
 * One follow-up on the same cards / same reading style.
 * Product: 每次含1次追问 — included in the reading session; do not consume an extra credit.
 * Sends session auth + follow-up signals (X-Reading-Follow-Up + metadata.followUp) so the
 * server skips deduct while REQUIRE_CREDITS_FOR_MESSAGES=1 still accepts the request.
 * Do not omit auth (anonymous) — that 401s when credits are required.
 */
function requestFollowUp(wxApi, cards, originalQuestion, priorResult, followUpQuestion, options = {}) {
  const spreadId = options.spreadId || DEFAULT_SPREAD;
  const data = buildFollowUpRequest(cards, originalQuestion, priorResult, followUpQuestion, spreadId);
  return postMessages(wxApi, data, cards, {
    useAuth: options.useAuth !== false,
    useClientCredit: false,
    followUp: true
  });
}

module.exports = {requestReading, requestFollowUp};
