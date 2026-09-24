/**
 * Pay / credits HTTP handlers for the single Node server.
 * Mounted from server/server.mjs — Render-compatible, no extra process.
 */
import { FREE_CREDITS_NEW_USER, getProduct } from './products.mjs';
import {
  code2Session,
  buildJsapiPayParams,
  parsePayNotify,
  hasWeChatPayCreds,
  maskOpenid,
  randomToken,
  newOrderId,
  isPayDevMode,
} from './wechat.mjs';

function bearerToken(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const x = String(req.headers['x-session-token'] || '').trim();
  return x || '';
}

function parseJsonBody(buf) {
  try {
    return JSON.parse(buf.toString('utf8') || '{}');
  } catch {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 1_000_000) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Ensure user exists; grant FREE_CREDITS_NEW_USER once on first sight.
 */
async function ensureUser(store, openid) {
  return store.withLock((data) => {
    let user = data.users[openid];
    if (!user) {
      user = {
        openid,
        credits: FREE_CREDITS_NEW_USER,
        freeGranted: FREE_CREDITS_NEW_USER,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      data.users[openid] = user;
    }
    return { ...user };
  });
}

async function mintSession(store, openid) {
  const token = randomToken(32);
  await store.withLock((data) => {
    data.sessions[token] = { openid, createdAt: Date.now() };
  });
  return token;
}

async function resolveSession(store, token) {
  if (!token) return null;
  const data = await store.peek();
  const sess = data.sessions[token];
  if (!sess) return null;
  const user = data.users[sess.openid];
  if (!user) return null;
  return { token, openid: sess.openid, user: { ...user } };
}

function requireCreditsEnv() {
  const v = String(process.env.REQUIRE_CREDITS_FOR_MESSAGES || '0').trim();
  return v === '1' || v.toLowerCase() === 'true';
}

export function createPayApi(store) {
  async function handleWechatLogin(req, res, sendJson) {
    const body = parseJsonBody(await readBody(req));
    const code = body.code;
    const { openid } = await code2Session(code);
    const user = await ensureUser(store, openid);
    const sessionToken = await mintSession(store, openid);
    sendJson(res, 200, {
      sessionToken,
      openidMasked: maskOpenid(openid),
      credits: user.credits,
      freeGranted: user.freeGranted || 0,
    });
  }

  async function handleGetCredits(req, res, sendJson) {
    const token = bearerToken(req);
    const sess = await resolveSession(store, token);
    if (!sess) {
      sendJson(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }
    sendJson(res, 200, {
      credits: sess.user.credits,
      freeGranted: sess.user.freeGranted || 0,
      openidMasked: maskOpenid(sess.openid),
    });
  }

  async function handleCreateOrder(req, res, sendJson) {
    const token = bearerToken(req);
    const sess = await resolveSession(store, token);
    if (!sess) {
      sendJson(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }
    const body = parseJsonBody(await readBody(req));
    const product = getProduct(body.productId);
    if (!product) {
      sendJson(res, 400, { error: { message: 'Unknown productId' } });
      return;
    }

    const orderId = newOrderId();
    const order = {
      orderId,
      openid: sess.openid,
      productId: product.id,
      priceFen: product.priceFen,
      credits: product.credits,
      status: 'pending',
      createdAt: Date.now(),
      paidAt: null,
    };

    await store.withLock((data) => {
      data.orders[orderId] = order;
    });

    const built = await buildJsapiPayParams({
      orderId,
      priceFen: product.priceFen,
      openid: sess.openid,
      description: product.title,
    });

    if (!built.ok) {
      sendJson(res, built.status || 501, {
        orderId,
        productId: product.id,
        priceFen: product.priceFen,
        credits: product.credits,
        payParams: null,
        error: built.error,
      });
      return;
    }

    sendJson(res, 200, {
      orderId,
      productId: product.id,
      priceFen: product.priceFen,
      credits: product.credits,
      payParams: built.payParams,
    });
  }

  /**
   * WeChat notify OR DEV mock: { orderId, mockPaid: true } with session auth.
   * Idempotent by orderId — double notify never double-credits.
   */
  async function handlePayNotify(req, res, sendJson) {
    const rawBuf = await readBody(req);
    const rawText = rawBuf.toString('utf8');
    let body = {};
    try {
      body = JSON.parse(rawText || '{}');
    } catch {
      sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
      return;
    }

    // DEV mock path
    if (body.mockPaid === true || body.devMock === true) {
      if (!isPayDevMode()) {
        sendJson(res, 403, { error: { message: 'mockPaid only allowed when PAY_DEV_MODE=1' } });
        return;
      }
      const token = bearerToken(req);
      const sess = await resolveSession(store, token);
      if (!sess) {
        sendJson(res, 401, { error: { message: 'Unauthorized' } });
        return;
      }
      const orderId = String(body.orderId || '').trim();
      if (!orderId) {
        sendJson(res, 400, { error: { message: 'Missing orderId' } });
        return;
      }

      const result = await store.withLock((data) => {
        const order = data.orders[orderId];
        if (!order) return { status: 404, error: { message: 'Order not found' } };
        if (order.openid !== sess.openid) return { status: 403, error: { message: 'Order not yours' } };

        if (data.notifyHandled[orderId] || order.status === 'paid') {
          const user = data.users[order.openid];
          return {
            status: 200,
            body: {
              ok: true,
              alreadyPaid: true,
              orderId,
              credits: user?.credits ?? 0,
            },
          };
        }

        const user = data.users[order.openid];
        if (!user) return { status: 404, error: { message: 'User not found' } };

        user.credits = (user.credits || 0) + order.credits;
        user.updatedAt = Date.now();
        order.status = 'paid';
        order.paidAt = Date.now();
        data.notifyHandled[orderId] = { at: Date.now(), source: 'dev_mock' };

        return {
          status: 200,
          body: {
            ok: true,
            alreadyPaid: false,
            orderId,
            credited: order.credits,
            credits: user.credits,
          },
        };
      });

      if (result.error) {
        sendJson(res, result.status, { error: result.error });
        return;
      }
      sendJson(res, result.status, result.body);
      return;
    }

    // Real WeChat Pay v3 notify (signature verify + AEAD decrypt → credit)
    if (hasWeChatPayCreds()) {
      const parsed = await parsePayNotify({ headers: req.headers || {}, rawBody: rawText });
      if (!parsed.ok) {
        // WeChat expects FAIL JSON on verify errors so it retries / alerts
        sendJson(res, parsed.status || 401, {
          code: 'FAIL',
          message: parsed.error?.message || 'notify verify failed',
        });
        return;
      }

      const tx = parsed.transaction || {};
      const orderId = String(tx.out_trade_no || '').trim();
      const tradeState = String(tx.trade_state || '').toUpperCase();

      if (tradeState && tradeState !== 'SUCCESS') {
        sendJson(res, 200, { code: 'SUCCESS', message: 'ignored non-success state' });
        return;
      }
      if (!orderId) {
        sendJson(res, 400, { code: 'FAIL', message: 'missing out_trade_no' });
        return;
      }

      // Optional amount check when WeChat sends amount.total
      const paidTotal = tx.amount?.total;
      const result = await markOrderPaid(store, orderId, 'wechat_notify', {
        expectedFen: paidTotal,
        transactionId: tx.transaction_id || '',
      });

      if (result.error) {
        sendJson(res, result.status || 400, {
          code: 'FAIL',
          message: result.error.message || 'credit failed',
        });
        return;
      }
      sendJson(res, 200, { code: 'SUCCESS', message: '成功' });
      return;
    }

    // Escape hatch for staging only — never enable in production with real money
    if (body._skeletonAcceptUnverified === true && process.env.PAY_ALLOW_UNVERIFIED_NOTIFY === '1') {
      const orderId = String(body.orderId || body.out_trade_no || '').trim();
      const result = await markOrderPaid(store, orderId, 'unverified_notify');
      sendJson(res, result.status, result.body || { error: result.error });
      return;
    }

    sendJson(res, 501, {
      error: {
        message:
          'Real WeChat pay notify requires pay credentials (WECHAT_MCH_ID, WECHAT_API_V3_KEY, ' +
          'WECHAT_MCH_SERIAL_NO, WECHAT_MCH_PRIVATE_KEY, WECHAT_NOTIFY_URL). ' +
          'In PAY_DEV_MODE POST {orderId, mockPaid:true} with Bearer sessionToken.',
      },
    });
  }

  async function markOrderPaid(storeRef, orderId, source, opts = {}) {
    if (!orderId) return { status: 400, error: { message: 'Missing orderId' } };
    return storeRef.withLock((data) => {
      const order = data.orders[orderId];
      if (!order) return { status: 404, error: { message: 'Order not found' } };
      if (
        opts.expectedFen != null &&
        Number(opts.expectedFen) !== Number(order.priceFen)
      ) {
        return {
          status: 400,
          error: { message: 'Paid amount does not match order' },
        };
      }
      if (data.notifyHandled[orderId] || order.status === 'paid') {
        const user = data.users[order.openid];
        return {
          status: 200,
          body: { ok: true, alreadyPaid: true, orderId, credits: user?.credits ?? 0 },
        };
      }
      const user = data.users[order.openid];
      if (!user) return { status: 404, error: { message: 'User not found' } };
      user.credits = (user.credits || 0) + order.credits;
      user.updatedAt = Date.now();
      order.status = 'paid';
      order.paidAt = Date.now();
      if (opts.transactionId) order.transactionId = String(opts.transactionId);
      data.notifyHandled[orderId] = { at: Date.now(), source };
      return {
        status: 200,
        body: {
          ok: true,
          alreadyPaid: false,
          orderId,
          credited: order.credits,
          credits: user.credits,
        },
      };
    });
  }

  async function handleConsume(req, res, sendJson) {
    const token = bearerToken(req);
    const sess = await resolveSession(store, token);
    if (!sess) {
      sendJson(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }
    const body = parseJsonBody(await readBody(req).catch(() => Buffer.from('{}')));
    const amount = Math.max(1, Number(body.amount) || 1);

    const result = await store.withLock((data) => {
      const user = data.users[sess.openid];
      if (!user) return { status: 404, error: { message: 'User not found' } };
      if ((user.credits || 0) < amount) {
        return { status: 402, error: { message: 'Insufficient credits', credits: user.credits || 0 } };
      }
      user.credits -= amount;
      user.updatedAt = Date.now();
      return { status: 200, body: { ok: true, deducted: amount, credits: user.credits } };
    });

    if (result.error) {
      sendJson(res, result.status, { error: result.error, credits: result.error.credits });
      return;
    }
    sendJson(res, result.status, result.body);
  }

  async function handleRefund(req, res, sendJson) {
    const token = bearerToken(req);
    const sess = await resolveSession(store, token);
    if (!sess) {
      sendJson(res, 401, { error: { message: 'Unauthorized' } });
      return;
    }
    const body = parseJsonBody(await readBody(req).catch(() => Buffer.from('{}')));
    const amount = Math.max(1, Number(body.amount) || 1);

    const result = await store.withLock((data) => {
      const user = data.users[sess.openid];
      if (!user) return { status: 404, error: { message: 'User not found' } };
      user.credits = (user.credits || 0) + amount;
      user.updatedAt = Date.now();
      return { status: 200, body: { ok: true, refunded: amount, credits: user.credits } };
    });

    if (result.error) {
      sendJson(res, result.status, { error: result.error });
      return;
    }
    sendJson(res, result.status, result.body);
  }

  /**
   * Atomic deduct for messages middleware. Returns {ok, credits} or {ok:false, status, error}.
   */
  async function deductCreditForOpenid(openid, amount = 1) {
    return store.withLock((data) => {
      const user = data.users[openid];
      if (!user) return { ok: false, status: 401, error: { message: 'User not found' } };
      if ((user.credits || 0) < amount) {
        return { ok: false, status: 402, error: { message: 'Insufficient credits', credits: user.credits || 0 } };
      }
      user.credits -= amount;
      user.updatedAt = Date.now();
      return { ok: true, credits: user.credits, openid };
    });
  }

  async function refundCreditForOpenid(openid, amount = 1) {
    return store.withLock((data) => {
      const user = data.users[openid];
      if (!user) return { ok: false };
      user.credits = (user.credits || 0) + amount;
      user.updatedAt = Date.now();
      return { ok: true, credits: user.credits };
    });
  }

  /**
   * @returns {Promise<boolean>} true if request was handled
   */
  async function tryHandle(req, res, sendJson) {
    const urlPath = (req.url || '').split('?')[0];
    const method = req.method || 'GET';

    try {
      if (method === 'POST' && urlPath === '/v1/auth/wechat-login') {
        await handleWechatLogin(req, res, sendJson);
        return true;
      }
      if (method === 'GET' && urlPath === '/v1/credits') {
        await handleGetCredits(req, res, sendJson);
        return true;
      }
      if (method === 'POST' && urlPath === '/v1/orders') {
        await handleCreateOrder(req, res, sendJson);
        return true;
      }
      if (method === 'POST' && urlPath === '/v1/pay/notify') {
        await handlePayNotify(req, res, sendJson);
        return true;
      }
      if (method === 'POST' && urlPath === '/v1/credits/consume') {
        await handleConsume(req, res, sendJson);
        return true;
      }
      if (method === 'POST' && urlPath === '/v1/credits/refund') {
        await handleRefund(req, res, sendJson);
        return true;
      }
    } catch (err) {
      const status = err.status || 500;
      sendJson(res, status, { error: { message: err.message || 'Internal error' } });
      return true;
    }
    return false;
  }

  return {
    tryHandle,
    resolveSession,
    bearerToken,
    deductCreditForOpenid,
    refundCreditForOpenid,
    requireCreditsEnv,
    ensureUser,
    mintSession,
    // test helpers
    FREE_CREDITS_NEW_USER,
  };
}
