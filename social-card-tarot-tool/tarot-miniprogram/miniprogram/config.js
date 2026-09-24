// Product catalog + pay copy live in utils/; pay UI must import from there.
// apiBase drives login / orders / credits; readingEndpoint stays the messages proxy.
const {FREE_CREDITS_NEW_USER, PRODUCTS, getProduct, getPrimaryProduct} = require('./utils/products');
const {PAY_COPY} = require('./utils/pay-copy');

// Production Render backend (current default until EdgeOne / DNSPod proxy is live).
// For local PAY_DEV_MODE, point both at http://127.0.0.1:8790
// (WeChat devtools: 详情 → 本地设置 → 不校验合法域名).
const API_BASE = 'https://intuitive-tarot-production.onrender.com';

// --- After 公安备案 + 合法域名 proxy is live, switch apiBase to the product domain: ---
// const API_BASE_PRODUCTION_DOMAIN = 'https://api.witchtable.cn';
// // or: 'https://www.witchtable.cn/api' if you reverse-proxy /api → Render
// const API_BASE = API_BASE_PRODUCTION_DOMAIN;
// Then configure 小程序后台 → 开发 → 开发管理 → 开发设置 → 服务器域名
// request 合法域名: https://api.witchtable.cn (or https://www.witchtable.cn)
// Do NOT switch until the CNAME/HTTPS proxy to Render answers /health.

module.exports = {
  assetBase: 'https://cyauio-intuitive-tarot.franklinandina141.chatgpt.site/assets',
  apiBase: API_BASE,
  readingEndpoint: `${API_BASE}/v1/messages`,
  // Launch rules: free 2 for new users; WeChat native pay; no monthly membership.
  freeCreditsNewUser: FREE_CREDITS_NEW_USER,
  products: PRODUCTS,
  payCopy: PAY_COPY,
  getProduct,
  getPrimaryProduct,
  // Privacy / terms contact (Franklin 2026-09-24)
  legalContact: '874023448@qq.com'
};
