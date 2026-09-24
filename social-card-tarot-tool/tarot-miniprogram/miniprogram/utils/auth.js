// WeChat login + session token + credits helpers for 女巫的牌桌 pay skeleton.
const {apiBase} = require('../config');

const TOKEN_KEY = 'witch_session_token';
const CREDITS_KEY = 'witch_credits';

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || '';
  } catch (_) {
    return '';
  }
}

function setToken(token) {
  try {
    if (token) wx.setStorageSync(TOKEN_KEY, token);
    else wx.removeStorageSync(TOKEN_KEY);
  } catch (_) {}
}

function getCachedCredits() {
  try {
    const n = wx.getStorageSync(CREDITS_KEY);
    return typeof n === 'number' ? n : null;
  } catch (_) {
    return null;
  }
}

function setCachedCredits(credits) {
  try {
    if (typeof credits === 'number') wx.setStorageSync(CREDITS_KEY, credits);
  } catch (_) {}
}

function requestJson({url, method = 'GET', data, header = {}}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout: 20000,
      header: {'content-type': 'application/json', ...header},
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.error && res.data.error.message) || `HTTP ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || 'network error'));
      }
    });
  });
}

function authHeader() {
  const token = getToken();
  return token ? {Authorization: `Bearer ${token}`, 'X-Session-Token': token} : {};
}

/**
 * Login via wx.login code → POST /v1/auth/wechat-login.
 * In local PAY_DEV_MODE backend, code "dev" is accepted when WeChat secrets missing.
 */
function login(wxApi = wx, {devCode = ''} = {}) {
  return new Promise((resolve, reject) => {
    function exchange(code) {
      requestJson({
        url: `${apiBase}/v1/auth/wechat-login`,
        method: 'POST',
        data: {code}
      })
        .then((data) => {
          setToken(data.sessionToken);
          setCachedCredits(data.credits);
          resolve(data);
        })
        .catch(reject);
    }

    if (devCode) {
      exchange(devCode);
      return;
    }

    wxApi.login({
      success(res) {
        if (!res.code) {
          // Developer tool without real WeChat: fall back to dev code.
          exchange('dev');
          return;
        }
        exchange(res.code);
      },
      fail() {
        exchange('dev');
      }
    });
  });
}

function ensureLogin(wxApi = wx) {
  if (getToken()) {
    return fetchCredits().catch(() => login(wxApi));
  }
  return login(wxApi);
}

function fetchCredits() {
  const token = getToken();
  if (!token) return Promise.reject(new Error('not logged in'));
  return requestJson({
    url: `${apiBase}/v1/credits`,
    method: 'GET',
    header: authHeader()
  }).then((data) => {
    setCachedCredits(data.credits);
    return data;
  });
}

function createOrder(productId) {
  return requestJson({
    url: `${apiBase}/v1/orders`,
    method: 'POST',
    header: authHeader(),
    data: {productId}
  });
}

/**
 * Complete payment: real wx.requestPayment when payParams has package/paySign;
 * otherwise POST mock notify when payParams.devMock (PAY_DEV_MODE).
 */
function completePayment(order, wxApi = wx) {
  const payParams = order && order.payParams;
  if (payParams && payParams.package && payParams.paySign) {
    return new Promise((resolve, reject) => {
      wxApi.requestPayment({
        timeStamp: String(payParams.timeStamp),
        nonceStr: payParams.nonceStr,
        package: payParams.package,
        signType: payParams.signType || 'RSA',
        paySign: payParams.paySign,
        success() {
          fetchCredits().then(resolve).catch(() => resolve({ok: true}));
        },
        fail(err) {
          reject(new Error(err.errMsg || 'pay fail'));
        }
      });
    });
  }

  if (payParams && payParams.devMock) {
    return requestJson({
      url: `${apiBase}/v1/pay/notify`,
      method: 'POST',
      header: authHeader(),
      data: {orderId: order.orderId, mockPaid: true}
    }).then((data) => {
      if (typeof data.credits === 'number') setCachedCredits(data.credits);
      return data;
    });
  }

  return Promise.reject(new Error('支付参数未就绪'));
}

function buyProduct(productId, wxApi = wx) {
  return ensureLogin(wxApi)
    .then(() => createOrder(productId))
    .then((order) => completePayment(order, wxApi));
}

function consumeCredit(amount = 1) {
  return requestJson({
    url: `${apiBase}/v1/credits/consume`,
    method: 'POST',
    header: authHeader(),
    data: {amount}
  }).then((data) => {
    if (typeof data.credits === 'number') setCachedCredits(data.credits);
    return data;
  });
}

function refundCredit(amount = 1) {
  return requestJson({
    url: `${apiBase}/v1/credits/refund`,
    method: 'POST',
    header: authHeader(),
    data: {amount}
  }).then((data) => {
    if (typeof data.credits === 'number') setCachedCredits(data.credits);
    return data;
  });
}

module.exports = {
  getToken,
  setToken,
  getCachedCredits,
  setCachedCredits,
  authHeader,
  login,
  ensureLogin,
  fetchCredits,
  createOrder,
  completePayment,
  buyProduct,
  consumeCredit,
  refundCredit
};
