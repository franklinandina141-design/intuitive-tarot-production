/**
 * WeChat login (code2Session) + JSAPI Pay v3 (unified order + notify verify/decrypt).
 *
 * Real money path is env-gated. Required for production pay:
 *   WECHAT_APPID, WECHAT_SECRET (login),
 *   WECHAT_MCH_ID, WECHAT_API_V3_KEY, WECHAT_MCH_SERIAL_NO,
 *   WECHAT_MCH_PRIVATE_KEY or WECHAT_MCH_PRIVATE_KEY_PATH,
 *   WECHAT_NOTIFY_URL
 *
 * Optional notify signature verify:
 *   WECHAT_PLATFORM_CERT / WECHAT_PLATFORM_PUBLIC_KEY
 *   (if unset, platform certs are fetched via GET /v3/certificates and cached)
 *
 * If pay credentials are missing, PAY_DEV_MODE=1 keeps the mock path.
 * Never log secrets (APP secret, API v3 key, private keys).
 */
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';

function getEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

export function isPayDevMode() {
  const v = getEnv('PAY_DEV_MODE', '0');
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
}

export function hasWeChatLoginCreds() {
  return Boolean(getEnv('WECHAT_APPID') && getEnv('WECHAT_SECRET'));
}

function loadMerchantPrivateKey() {
  const inline = getEnv('WECHAT_MCH_PRIVATE_KEY');
  if (inline) {
    return inline.includes('-----BEGIN') ? inline : inline.replace(/\\n/g, '\n');
  }
  const keyPath = getEnv('WECHAT_MCH_PRIVATE_KEY_PATH');
  if (keyPath && fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8');
  }
  return '';
}

export function hasWeChatPayCreds() {
  return Boolean(
    getEnv('WECHAT_APPID') &&
      getEnv('WECHAT_MCH_ID') &&
      getEnv('WECHAT_API_V3_KEY') &&
      getEnv('WECHAT_NOTIFY_URL') &&
      getEnv('WECHAT_MCH_SERIAL_NO') &&
      loadMerchantPrivateKey()
  );
}

function httpsRequest({ method, hostname, path: reqPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = {};
          try {
            json = JSON.parse(raw || '{}');
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode || 500, headers: res.headers, json, raw });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode || 500, json: JSON.parse(raw || '{}'), raw });
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Exchange wx.login code for openid.
 * In PAY_DEV_MODE with code "dev" (or missing WeChat secrets), mint openid=dev_*.
 */
export async function code2Session(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    const err = new Error('Missing code');
    err.status = 400;
    throw err;
  }

  if (hasWeChatLoginCreds()) {
    const appid = getEnv('WECHAT_APPID');
    const secret = getEnv('WECHAT_SECRET');
    const url =
      `https://api.weixin.qq.com/sns/jscode2session` +
      `?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(trimmed)}` +
      `&grant_type=authorization_code`;
    const { json } = await httpsGetJson(url);
    if (json.errcode) {
      const err = new Error(json.errmsg || `WeChat code2Session error ${json.errcode}`);
      err.status = 401;
      err.wechat = { errcode: json.errcode };
      throw err;
    }
    if (!json.openid) {
      const err = new Error('WeChat code2Session returned no openid');
      err.status = 502;
      throw err;
    }
    return { openid: json.openid, sessionKey: json.session_key || '', unionid: json.unionid || '' };
  }

  if (isPayDevMode()) {
    if (trimmed === 'dev') {
      return { openid: 'dev_local', sessionKey: 'dev', unionid: '' };
    }
    if (trimmed.startsWith('dev_')) {
      return { openid: trimmed, sessionKey: 'dev', unionid: '' };
    }
    const hash = crypto.createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
    return { openid: `dev_${hash}`, sessionKey: 'dev', unionid: '' };
  }

  const err = new Error('WeChat login not configured (set WECHAT_APPID+WECHAT_SECRET or PAY_DEV_MODE=1)');
  err.status = 501;
  throw err;
}

function authAuthorization({ method, urlPath, body = '' }) {
  const mchId = getEnv('WECHAT_MCH_ID');
  const serialNo = getEnv('WECHAT_MCH_SERIAL_NO');
  const privateKey = loadMerchantPrivateKey();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",` +
    `nonce_str="${nonceStr}",` +
    `signature="${signature}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${serialNo}"`
  );
}

/**
 * Decrypt WeChat Pay v3 AEAD_AES_256_GCM resource (notify / certificates).
 */
export function decryptAesGcmResource({ ciphertext, nonce, associatedData, apiV3Key }) {
  const key = Buffer.from(apiV3Key || getEnv('WECHAT_API_V3_KEY'), 'utf8');
  if (key.length !== 32) {
    throw new Error('WECHAT_API_V3_KEY must be 32 bytes');
  }
  const buf = Buffer.from(ciphertext, 'base64');
  const data = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString('utf8');
}

/** Build mini-program wx.requestPayment paySign (RSA). */
export function buildMiniProgramPaySign({ appId, timeStamp, nonceStr, packageValue, privateKey }) {
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  return crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

/**
 * JSAPI / mini-program unified order → prepay_id → payParams for wx.requestPayment.
 */
export async function createJsapiPrepay({ orderId, priceFen, openid, description }) {
  if (!hasWeChatPayCreds()) {
    const err = new Error('WeChat Pay credentials incomplete');
    err.status = 501;
    throw err;
  }

  const appid = getEnv('WECHAT_APPID');
  const mchid = getEnv('WECHAT_MCH_ID');
  const notifyUrl = getEnv('WECHAT_NOTIFY_URL');
  const privateKey = loadMerchantPrivateKey();
  const urlPath = '/v3/pay/transactions/jsapi';
  const payload = {
    appid,
    mchid,
    description: String(description || '女巫的牌桌').slice(0, 127),
    out_trade_no: String(orderId),
    notify_url: notifyUrl,
    amount: {
      total: Number(priceFen),
      currency: 'CNY',
    },
    payer: {
      openid: String(openid),
    },
  };
  const body = JSON.stringify(payload);
  const authorization = authAuthorization({ method: 'POST', urlPath, body });

  const { status, json, raw } = await httpsRequest({
    method: 'POST',
    hostname: 'api.mch.weixin.qq.com',
    path: urlPath,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: authorization,
      'User-Agent': 'witchtable-pay/1.0',
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  if (status >= 400 || !json.prepay_id) {
    const err = new Error(
      (json && (json.message || json.code)) || `WeChat JSAPI prepay failed HTTP ${status}`
    );
    err.status = 502;
    err.wechat = { code: json?.code, status };
    // never attach raw body (may contain PII); keep code/status only
    void raw;
    throw err;
  }

  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${json.prepay_id}`;
  const paySign = buildMiniProgramPaySign({
    appId: appid,
    timeStamp,
    nonceStr,
    packageValue,
    privateKey,
  });

  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: 'RSA',
    paySign,
  };
}

/**
 * Build JSAPI payParams for wx.requestPayment.
 * Async: real path calls WeChat unified order.
 * Returns {ok, payParams} or {ok:false, status, error}.
 */
export async function buildJsapiPayParams({ orderId, priceFen, openid, description }) {
  if (hasWeChatPayCreds()) {
    try {
      const payParams = await createJsapiPrepay({ orderId, priceFen, openid, description });
      return { ok: true, payParams };
    } catch (err) {
      return {
        ok: false,
        status: err.status || 502,
        error: {
          message: err.message || 'WeChat JSAPI prepay failed',
          orderId,
          priceFen,
          openidMasked: maskOpenid(openid),
        },
      };
    }
  }

  if (isPayDevMode()) {
    return {
      ok: true,
      payParams: { devMock: true, orderId, priceFen },
    };
  }

  return {
    ok: false,
    status: 501,
    error: {
      message:
        'WeChat Pay not configured. Set WECHAT_APPID, WECHAT_MCH_ID, WECHAT_API_V3_KEY, ' +
        'WECHAT_MCH_SERIAL_NO, WECHAT_MCH_PRIVATE_KEY (or _PATH), WECHAT_NOTIFY_URL — ' +
        'or PAY_DEV_MODE=1 for mock pay.',
    },
  };
}

// --- Platform cert cache for notify signature verify ---
const platformCertCache = new Map(); // serial -> PEM public key / cert

function loadConfiguredPlatformKey() {
  const inline = getEnv('WECHAT_PLATFORM_PUBLIC_KEY') || getEnv('WECHAT_PLATFORM_CERT');
  if (inline) {
    return inline.includes('-----BEGIN') ? inline : inline.replace(/\\n/g, '\n');
  }
  const keyPath = getEnv('WECHAT_PLATFORM_CERT_PATH') || getEnv('WECHAT_PLATFORM_PUBLIC_KEY_PATH');
  if (keyPath && fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8');
  }
  return '';
}

export async function refreshPlatformCertificates() {
  if (!hasWeChatPayCreds()) return platformCertCache;
  const urlPath = '/v3/certificates';
  const authorization = authAuthorization({ method: 'GET', urlPath, body: '' });
  const { status, json } = await httpsRequest({
    method: 'GET',
    hostname: 'api.mch.weixin.qq.com',
    path: urlPath,
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      'User-Agent': 'witchtable-pay/1.0',
    },
  });
  if (status >= 400 || !Array.isArray(json.data)) {
    return platformCertCache;
  }
  const apiV3Key = getEnv('WECHAT_API_V3_KEY');
  for (const item of json.data) {
    const serial = item.serial_no;
    const enc = item.encrypt_certificate;
    if (!serial || !enc) continue;
    try {
      const pem = decryptAesGcmResource({
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
        associatedData: enc.associated_data || '',
        apiV3Key,
      });
      platformCertCache.set(serial, pem);
    } catch {
      // skip bad cert entry
    }
  }
  return platformCertCache;
}

function getPlatformKeyForSerial(serial) {
  if (platformCertCache.has(serial)) return platformCertCache.get(serial);
  const configured = loadConfiguredPlatformKey();
  if (configured) return configured;
  return '';
}

/**
 * Verify Wechatpay-Signature over `${timestamp}\n${nonce}\n${body}\n`.
 */
export function verifyNotifySignature({ timestamp, nonce, body, signature, serial }) {
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const key = getPlatformKeyForSerial(serial);
  if (!key) {
    return { ok: false, reason: 'missing_platform_cert' };
  }
  try {
    const ok = crypto.createVerify('RSA-SHA256').update(message).verify(key, signature, 'base64');
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'verify_error' };
  }
}

/**
 * Parse + verify + decrypt a WeChat Pay v3 payment notify.
 * @returns {{ ok:true, transaction }} or {{ ok:false, status, error }}
 */
export async function parsePayNotify({ headers = {}, rawBody }) {
  const raw = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody || '').toString('utf8');
  let envelope;
  try {
    envelope = JSON.parse(raw || '{}');
  } catch {
    return { ok: false, status: 400, error: { message: 'Invalid notify JSON' } };
  }

  const timestamp = String(headers['wechatpay-timestamp'] || headers['Wechatpay-Timestamp'] || '');
  const nonce = String(headers['wechatpay-nonce'] || headers['Wechatpay-Nonce'] || '');
  const signature = String(headers['wechatpay-signature'] || headers['Wechatpay-Signature'] || '');
  const serial = String(headers['wechatpay-serial'] || headers['Wechatpay-Serial'] || '');

  if (!timestamp || !nonce || !signature || !serial) {
    return { ok: false, status: 400, error: { message: 'Missing Wechatpay-* signature headers' } };
  }

  // Reject stale timestamps (>5 min) to limit replay
  const tsNum = Number(timestamp);
  if (Number.isFinite(tsNum)) {
    const drift = Math.abs(Date.now() / 1000 - tsNum);
    if (drift > 300) {
      return { ok: false, status: 401, error: { message: 'Notify timestamp out of range' } };
    }
  }

  let verified = verifyNotifySignature({ timestamp, nonce, body: raw, signature, serial });
  if (!verified.ok && verified.reason === 'missing_platform_cert') {
    await refreshPlatformCertificates();
    verified = verifyNotifySignature({ timestamp, nonce, body: raw, signature, serial });
  }
  if (!verified.ok) {
    return {
      ok: false,
      status: 401,
      error: { message: `Notify signature verify failed (${verified.reason})` },
    };
  }

  const resource = envelope.resource;
  if (!resource?.ciphertext || !resource?.nonce) {
    return { ok: false, status: 400, error: { message: 'Missing encrypted resource' } };
  }

  let plain;
  try {
    plain = decryptAesGcmResource({
      ciphertext: resource.ciphertext,
      nonce: resource.nonce,
      associatedData: resource.associated_data || '',
      apiV3Key: getEnv('WECHAT_API_V3_KEY'),
    });
  } catch {
    return { ok: false, status: 400, error: { message: 'Notify decrypt failed' } };
  }

  let transaction;
  try {
    transaction = JSON.parse(plain);
  } catch {
    return { ok: false, status: 400, error: { message: 'Decrypted notify is not JSON' } };
  }

  return { ok: true, transaction, eventType: envelope.event_type || '' };
}

export function maskOpenid(openid = '') {
  const s = String(openid);
  if (s.length <= 8) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function newOrderId() {
  // WeChat out_trade_no: 6–32 chars, digits/letters; keep compact
  return `o${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}
