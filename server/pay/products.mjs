/**
 * Server-side product catalog — must match
 * social-card-tarot-tool/tarot-miniprogram/miniprogram/utils/products.js
 * Never trust client priceFen / credits.
 */

export const FREE_CREDITS_NEW_USER = 2;

export const PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'single_1',
    title: '先续 1 次',
    credits: 1,
    priceYuan: '9.9',
    priceFen: 990,
    primary: false,
  }),
  Object.freeze({
    id: 'pack_5',
    title: '续杯 5 次',
    credits: 5,
    priceYuan: '29.9',
    priceFen: 2990,
    primary: true,
  }),
]);

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

export function getPrimaryProduct() {
  return PRODUCTS.find((p) => p.primary) || PRODUCTS[PRODUCTS.length - 1];
}
