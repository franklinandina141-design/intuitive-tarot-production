const {newSession, selectCard, setSpread} = require('../../utils/session');
const {fanStyle, pickerStyle} = require('../../utils/layout');
const {listSpreads, DEFAULT_SPREAD, getSpreadPositions} = require('../../utils/deck');
const {ensureLogin, fetchCredits, getCachedCredits} = require('../../utils/auth');

const DISCLAIMER = '本内容仅供娱乐与自我觉察，不构成决策建议，亦不替代医疗、法律或投资意见。';

Page({
  data: {
    question: '',
    deck: [],
    fanDeck: [],
    selected: [],
    slots: [null, null, null],
    pickerOpen: false,
    scrollLeft: 0,
    trackWidth: 0,
    spreadReady: false,
    loading: true,
    spreads: listSpreads(),
    spreadId: DEFAULT_SPREAD,
    spreadPositions: getSpreadPositions(DEFAULT_SPREAD),
    credits: null, creditsLoading: false,
    disclaimer: DISCLAIMER
  },
  onLoad() {
    this.width = wx.getWindowInfo().windowWidth;
    this.session = getApp().session;
    this.anchor = 38;
    this.started = Date.now();
    if (!this.session.spreadId) this.session.spreadId = DEFAULT_SPREAD;
    this.resetDeck();
    this.loaderDeadline = setTimeout(() => this.setData({loading: false, spreadReady: true}), 6000);
    this.refreshCredits();
  },
  onShow() {
    if (this.session) {
      this.setData({
        question: this.session.question,
        selected: this.session.cards,
        spreadId: this.session.spreadId || DEFAULT_SPREAD,
        spreadPositions: getSpreadPositions(this.session.spreadId || DEFAULT_SPREAD)
      });
    }
    this.refreshCredits();
  },
  refreshCredits() {
    const cached = getCachedCredits();
    this.setData({
      creditsLoading: true,
      credits: typeof cached === 'number' ? cached : this.data.credits
    });
    ensureLogin()
      .then(() => fetchCredits())
      .then((data) => {
        const credits = data.credits;
        getApp().credits = credits;
        this.setData({credits, creditsLoading: false});
      })
      .catch((err) => {
        this.setData({creditsLoading: false});
        // Keep chip visible; login/network quietly fails until domain/API works.
        console.warn('credits sync failed', err && err.message);
      });
  },
  roomLoaded() {
    clearTimeout(this.loaderDeadline);
    this.loaderTimer = setTimeout(() => this.setData({loading: false, spreadReady: true}), Math.max(0, 2800 - (Date.now() - this.started)));
  },
  roomFailed() {
    this.roomLoaded();
    wx.showToast({title: '场景图片未能显示', icon: 'none'});
  },
  resetDeck() {
    const start = Math.max(0, this.anchor - 4), end = Math.min(this.session.deck.length - 1, this.anchor + 5);
    const spreadId = this.session.spreadId || DEFAULT_SPREAD;
    this.setData({
      question: this.session.question,
      selected: this.session.cards,
      slots: [0, 1, 2].map(i => this.session.cards[i] || null),
      spreadId,
      spreadPositions: getSpreadPositions(spreadId),
      fanDeck: this.session.deck.slice(26, 52).map((card, i) => ({...card, fanStyle: fanStyle(i), chosen: this.session.cards.some(c => c.id === card.id)})),
      deck: this.session.deck.map((card, i) => ({...card, pickerStyle: pickerStyle(i, this.anchor * (this.width * .35 + 14), this.width), chosen: this.session.cards.some(c => c.id === card.id), loaded: i >= start && i <= end})),
      trackWidth: (this.session.deck.length - 1) * (this.width * .35 + 14) + this.width
    });
  },
  onQuestion(e) {
    this.session.question = e.detail.value;
    this.setData({question: e.detail.value});
  },
  pickSpread(e) {
    if (this.session.cards.length) {
      wx.showToast({title: '已抽牌时请先重新洗牌再换牌阵', icon: 'none'});
      return;
    }
    const id = e.currentTarget.dataset.id;
    setSpread(this.session, id);
    this.setData({spreadId: this.session.spreadId, spreadPositions: getSpreadPositions(this.session.spreadId)});
  },
  openPicker() {
    if (!getApp().allowAI) {
      if (this.consentOpen) return;
      this.consentOpen = true;
      wx.showModal({
        title: '开始牌卡自我探索',
        content: '抽完三张牌后，你的问题和牌卡将发送至解读服务，生成AI辅助的自我探索内容。请勿输入敏感信息。内容仅供娱乐与自我觉察，不构成决策建议，也不替代专业建议。',
        confirmText: '同意抽牌',
        cancelText: '暂不开始',
        success: res => { if (res.confirm) { getApp().allowAI = true; this.openPicker(); } },
        fail: () => wx.showToast({title: '请再次点击开始抽牌', icon: 'none'}),
        complete: () => { this.consentOpen = false; }
      });
      return;
    }
    if (this.data.selected.length >= 3) return this.startReading();
    this.setData({pickerOpen: true, scrollLeft: this.anchor * (this.width * .35 + 14)});
  },
  closePicker() { this.setData({pickerOpen: false}); },
  scrollDeck(e) {
    this.lastScroll = Date.now();
    const left = e.detail.scrollLeft;
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => {
      const step = this.width * .35 + 14, center = Math.round(left / step), patch = {};
      this.data.deck.forEach((_, i) => {
        patch[`deck[${i}].pickerStyle`] = pickerStyle(i, left, this.width);
        patch[`deck[${i}].loaded`] = Math.abs(i - center) <= 5;
      });
      this.setData(patch);
    }, 30);
  },
  touchStart(e) {
    const t = e.touches[0];
    this.touch = {x: t.clientX, y: t.clientY};
    this.dragged = Date.now() - (this.lastScroll || 0) < 140;
  },
  touchMove(e) {
    const t = e.touches[0];
    if (this.touch && Math.hypot(t.clientX - this.touch.x, t.clientY - this.touch.y) > 8) this.dragged = true;
  },
  choose(e) {
    if (this.dragged || Date.now() - (this.lastScroll || 0) < 140) return;
    const index = Number(e.currentTarget.dataset.index);
    if (!selectCard(this.session, index)) return;
    this.anchor = index;
    this.setData({selected: this.session.cards, slots: [0, 1, 2].map(i => this.session.cards[i] || null), [`deck[${index}].chosen`]: true});
    if (this.session.cards.length === 3) { this.closePicker(); this.startReading(); }
  },
  startReading() {
    if (this.session.cards.length === 3) wx.navigateTo({url: '/pages/reading/index'});
  },
  shuffle() {
    const spreadId = this.session.spreadId || DEFAULT_SPREAD;
    getApp().session = newSession(this.session.question, spreadId);
    this.session = getApp().session;
    this.anchor = 38;
    this.setData({spreadReady: false});
    this.resetDeck();
    setTimeout(() => this.setData({spreadReady: true}), 30);
  },
  help() {
    wx.showModal({
      title: '牌卡自我探索',
      content: '完整78张牌。先选牌阵（时间线 / 感情 / 工作），写下问题，左右滑动后轻触选择三张牌。牌卡用于自我观察与文化娱乐，不预测命运。第三张选好后进入AI辅助解读。问题和三张牌会发送至解读服务，仅在你同意后开始。',
      showCancel: false,
      confirmText: '知道了'
    });
  },
  openPrivacy() { wx.navigateTo({url: '/pages/legal/privacy/index'}); },
  openTerms() { wx.navigateTo({url: '/pages/legal/terms/index'}); },
  onUnload() {
    clearTimeout(this.loaderTimer);
    clearTimeout(this.loaderDeadline);
    clearTimeout(this.scrollTimer);
  }
});
