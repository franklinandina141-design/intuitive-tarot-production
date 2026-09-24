const {requestReading, requestFollowUp} = require('../../utils/request');
const {PAY_COPY} = require('../../utils/pay-copy');
const {PRODUCTS, getPrimaryProduct} = require('../../utils/products');
const {ensureLogin, fetchCredits, buyProduct, getCachedCredits} = require('../../utils/auth');
const {DEFAULT_SPREAD} = require('../../utils/deck');
const {canFollowUp} = require('../../utils/session');

const WAITING = ['此时此刻，你可以闭上眼睛，想着你的问题。', '专属于你的答案马上浮现哦～ ♡'];
const DISCLAIMER = '本内容仅供娱乐与自我觉察，不构成决策建议，亦不替代医疗、法律或投资意见。';

Page({
  data: {
    cards: [], question: '', loading: false, waiting: false, paperReady: false, paperFailed: false, result: null, error: '',
    chars: [], penStyle: '', penVisible: false, consentNeeded: false,
    paySoft: PAY_COPY.resultHasFree, payExhausted: PAY_COPY.resultExhausted, paywall: PAY_COPY.paywall,
    products: PRODUCTS, primaryProduct: getPrimaryProduct(),
    credits: null, creditsLoading: false, exhausted: false, paying: false, payMessage: '',
    disclaimer: DISCLAIMER,
    followUpAllowed: false, followUpUsed: false, followUpOpen: false,
    followUpQuestion: '', followUpResult: null, followUpLoading: false, followUpError: ''
  },
  onLoad() {
    this.session = getApp().session;
    this.paperDeadline = setTimeout(() => { if (!this.data.paperReady) this.paperError(); }, 2500);
    if (this.session.cards.length !== 3) { wx.navigateBack(); return; }
    const cached = getCachedCredits();
    this.setData({
      cards: this.session.cards,
      question: this.session.question || '这三张牌，呈现怎样的整体状态？',
      chars: WAITING.flatMap((line, row) => [...line].map((char, i) => ({char, row, breakBefore: row > 0 && i === 0, visible: false}))),
      credits: cached,
      exhausted: typeof cached === 'number' ? cached <= 0 : false,
      followUpUsed: Boolean(this.session.followUpUsed),
      followUpResult: this.session.followUpResult || null,
      followUpAllowed: false
    });
    this.refreshCredits();
    if (this.session.result) {
      this.setData({
        result: this.session.result,
        followUpAllowed: canFollowUp(this.session),
        followUpUsed: Boolean(this.session.followUpUsed),
        followUpResult: this.session.followUpResult || null
      });
      return;
    }
    if (getApp().allowAI) this.run(); else this.setData({consentNeeded: true});
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
        this.setData({credits, exhausted: credits <= 0, payMessage: '', creditsLoading: false});
      })
      .catch((err) => {
        this.setData({creditsLoading: false});
        console.warn('credits sync failed', err && err.message);
      });
  },
  agree() { getApp().allowAI = true; this.setData({consentNeeded: false}); this.run(); },
  back() { wx.navigateBack(); },
  openPrivacy() { wx.navigateTo({url: '/pages/legal/privacy/index'}); },
  openTerms() { wx.navigateTo({url: '/pages/legal/terms/index'}); },
  paperLoaded() { clearTimeout(this.paperDeadline); this.setData({paperReady: true, paperFailed: false}, () => { if (this.data.waiting) this.write(); }); },
  paperError() { clearTimeout(this.paperDeadline); this.setData({paperReady: true, paperFailed: true}, () => { if (this.data.waiting) this.write(); }); },
  run() {
    if (this.data.loading) return;
    this.stopWriting(); this.active = true; this.received = null; this.pendingError = null; this.written = false; this.measureAttempts = 0; this.runId = (this.runId || 0) + 1; const runId = this.runId;
    this.setData({loading: true, waiting: true, result: null, error: '', penVisible: false, followUpAllowed: false, chars: this.data.chars.map(c => ({...c, visible: false}))}, () => this.write());
    const task = requestReading(wx, this.session.cards, this.session.question, {spreadId: this.session.spreadId || DEFAULT_SPREAD});
    this.task = task;
    task.promise.then(result => {
      if (!this.active || runId !== this.runId) return;
      this.received = result;
      this.session.result = result;
      this.session.followUpUsed = false;
      this.session.followUpResult = null;
      this.showResult();
      this.refreshCredits();
    }).catch(error => {
      if (!this.active || runId !== this.runId) return;
      this.pendingError = error.message;
      this.showResult();
    });
  },
  write() {
    if (this.timer || this.measuring || this.written || !this.active || !this.data.waiting || !this.data.paperReady) return;
    this.measuring = true; const runId = this.runId;
    wx.nextTick(() => this.createSelectorQuery().select('.paper-content').boundingClientRect().selectAll('.ink-char').boundingClientRect().exec(rects => {
      if (!this.active || runId !== this.runId) return;
      this.measuring = false;
      if (!rects[0] || !rects[1] || rects[1].length !== this.data.chars.length || rects[1].some(p => !p || !p.width)) {
        if (++this.measureAttempts < 12) this.measureTimer = setTimeout(() => this.write(), 180);
        else this.setData({loading: false, waiting: false, penVisible: false, error: '手稿暂未排版完成，请重新尝试。'});
        return;
      }
      const box = rects[0], points = rects[1]; let index = 0;
      this.timer = setInterval(() => {
        if (index >= this.data.chars.length) { clearInterval(this.timer); this.timer = null; this.written = true; this.setData({penVisible: false}); this.showResult(); return; }
        const p = points[index]; this.setData({[`chars[${index}].visible`]: true, penVisible: true, penStyle: `left:${p.right - box.left - 8}px;top:${p.bottom - box.top - 83}px;transform:rotate(${index % 2 ? 2 : 0}deg)`}); index++;
      }, 260);
    }));
  },
  showResult() {
    if (this.active && this.written && (this.received || this.pendingError)) {
      this.setData({
        result: this.received,
        error: this.pendingError || '',
        loading: false,
        waiting: false,
        penVisible: false,
        followUpAllowed: Boolean(this.received) && canFollowUp(this.session),
        followUpUsed: Boolean(this.session.followUpUsed),
        followUpResult: this.session.followUpResult || null
      });
    }
  },
  stopWriting() { clearInterval(this.timer); clearTimeout(this.measureTimer); this.timer = null; this.measuring = false; },
  cancel() { this.active = false; this.task?.abort(); this.stopWriting(); this.setData({loading: false, waiting: false, penVisible: false, error: '已取消本次等待。'}); },
  retry() { this.run(); },
  openFollowUp() {
    if (!canFollowUp(this.session) || this.data.followUpLoading) return;
    this.setData({followUpOpen: true, followUpError: ''});
  },
  onFollowUpInput(e) { this.setData({followUpQuestion: e.detail.value}); },
  cancelFollowUp() { this.setData({followUpOpen: false, followUpQuestion: '', followUpError: ''}); },
  submitFollowUp() {
    // Product: 每次含1次追问 — free & paid sessions include one follow-up; no extra credit.
    if (!canFollowUp(this.session) || this.data.followUpLoading) return;
    const q = String(this.data.followUpQuestion || '').trim();
    if (!q) {
      this.setData({followUpError: '请先写下追问。'});
      return;
    }
    this.setData({followUpLoading: true, followUpError: ''});
    const task = requestFollowUp(
      wx,
      this.session.cards,
      this.session.question,
      this.session.result,
      q,
      {spreadId: this.session.spreadId || DEFAULT_SPREAD}
    );
    this.followTask = task;
    task.promise.then((result) => {
      this.session.followUpUsed = true;
      this.session.followUpResult = result;
      this.setData({
        followUpLoading: false,
        followUpOpen: false,
        followUpUsed: true,
        followUpAllowed: false,
        followUpResult: result,
        followUpQuestion: ''
      });
    }).catch((err) => {
      this.setData({followUpLoading: false, followUpError: err.message || '追问暂时不可用'});
    });
  },
  buy(e) {
    if (this.data.paying) return;
    const productId = e.currentTarget.dataset.productId || (this.data.primaryProduct && this.data.primaryProduct.id) || 'pack_5';
    this.setData({paying: true, payMessage: ''});
    buyProduct(productId)
      .then((data) => {
        const credits = typeof data.credits === 'number' ? data.credits : getCachedCredits();
        getApp().credits = credits;
        this.setData({
          paying: false,
          credits,
          exhausted: typeof credits === 'number' ? credits <= 0 : false,
          payMessage: PAY_COPY.paywall.paySuccess
        });
        wx.showToast({title: '续杯成功', icon: 'success'});
      })
      .catch(() => {
        this.setData({paying: false, payMessage: PAY_COPY.paywall.payFail});
        wx.showToast({title: '续杯未完成', icon: 'none'});
      });
  },
  onUnload() {
    this.active = false;
    this.task?.abort();
    this.followTask?.abort();
    this.stopWriting();
    clearTimeout(this.paperDeadline);
  }
});
