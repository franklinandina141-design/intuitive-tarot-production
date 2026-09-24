const {shuffledDeck, DEFAULT_SPREAD, SPREADS} = require('./deck');
const auth = require('./auth');

function normalizeSpread(spreadId) {
  return SPREADS[spreadId] ? spreadId : DEFAULT_SPREAD;
}

function newSession(question = '', spreadId = DEFAULT_SPREAD) {
  return {
    question,
    spreadId: normalizeSpread(spreadId),
    deck: shuffledDeck(),
    cards: [],
    status: 'idle',
    result: null,
    // Product rule: 每次含1次追问 — one follow-up included in this reading session (free or paid).
    followUpUsed: false,
    followUpResult: null
  };
}

function selectCard(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.deck.length || session.cards.length >= 3) return false;
  const card = session.deck[index];
  if (session.cards.some(c => c.id === card.id)) return false;
  session.cards.push({...card});
  return true;
}

function setSpread(session, spreadId) {
  session.spreadId = normalizeSpread(spreadId);
  return session.spreadId;
}

function canFollowUp(session) {
  return Boolean(session && session.result && !session.followUpUsed);
}

module.exports = {
  newSession,
  selectCard,
  setSpread,
  canFollowUp,
  DEFAULT_SPREAD,
  // Auth / credits (pay skeleton) — re-exported for a single session entrypoint
  getToken: auth.getToken,
  ensureLogin: auth.ensureLogin,
  login: auth.login,
  fetchCredits: auth.fetchCredits,
  getCachedCredits: auth.getCachedCredits,
  buyProduct: auth.buyProduct,
  consumeCredit: auth.consumeCredit,
  refundCredit: auth.refundCredit,
  authHeader: auth.authHeader
};
