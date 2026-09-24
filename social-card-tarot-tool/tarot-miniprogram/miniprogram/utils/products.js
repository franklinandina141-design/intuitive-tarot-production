// Locked launch products for 女巫的牌桌 WeChat pay.
// Server must validate priceFen / credits on order create and notify; do not trust client alone.
// Launch: free 2 for new users; WeChat native pay only; no monthly membership.

const FREE_CREDITS_NEW_USER = 2;

const PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'single_1',
    title: '先续 1 次',
    credits: 1,
    priceYuan: '9.9',
    priceFen: 990,
    primary: false,
    badge: '',
    buttonLabel: '先续 1 次｜¥9.9',
    exhaustedButtonLabel: '先只要 1 次｜¥9.9'
  }),
  Object.freeze({
    id: 'pack_5',
    title: '续杯 5 次',
    credits: 5,
    priceYuan: '29.9',
    priceFen: 2990,
    primary: true,
    badge: '推荐',
    buttonLabel: '续杯 5 次｜¥29.9',
    exhaustedButtonLabel: '续杯 5 次｜¥29.9',
    primaryHint: '比单次更香'
  })
]);

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

function getPrimaryProduct() {
  return PRODUCTS.find((p) => p.primary) || PRODUCTS[PRODUCTS.length - 1];
}

module.exports = {
  FREE_CREDITS_NEW_USER,
  PRODUCTS,
  getProduct,
  getPrimaryProduct
};
