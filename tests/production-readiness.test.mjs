import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/server.mjs'), 'utf8');

function assertIncludesAll(text, snippets, label) {
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${label} missing: ${snippet}`);
  }
}

test('production HTML has visible ethics and decision-boundary disclaimer', () => {
  assertIncludesAll(html, [
    '塔羅解讀僅供自我覺察與娛樂參考',
    '不能替代醫療、法律、財務或心理專業建議',
    '最終選擇權仍然在你手上'
  ], 'disclaimer');
});

test('browser code keeps provider key private and defaults Vercel frontend to deployed Render backend', () => {
  assert.ok(!html.includes('sk-ant-'), 'HTML must not contain Anthropic secret key');
  assert.ok(!html.includes('sk-a'), 'HTML must not contain Sub2API/OpenAI-compatible secret key');
  assert.ok(!html.includes('Authorization'), 'HTML must not set Authorization in browser');
  assert.ok(!html.includes('x-api-key'), 'HTML must not set x-api-key in browser');
  assertIncludesAll(html, [
    '/v1/messages',
    'https://intuitive-tarot-production.onrender.com',
    'DEFAULT_TAROT_API_ORIGIN',
    'TAROT_API_ORIGIN',
    'localStorage.getItem',
    'setApiOrigin'
  ], 'frontend backend origin config');
});

test('all tarot images have real RWS source and robust fallback handlers', () => {
  assertIncludesAll(html, [
    'Special:FilePath',
    'RWS Tarot 00 Fool.jpg',
    'data-fb',
    'tarotImgFallback',
    'tarotReadingImgFallback',
    'decodeURIComponent(fb)',
    'markImageLoaded(el)',
    'markImageLoaded(this)'
  ], 'image fallback');
});

test('professional prompt forbids template sameness and absolute advice', () => {
  assertIncludesAll(html, [
    '嚴禁使用任何固定模板句子',
    '醫療、法律、財務',
    '避免命令式語氣',
    '選擇權仍然在用戶手上'
  ], 'professional prompt');
});

test('reading output uses stable appended paragraph reveal and broader conversational tarot lens', () => {
  assertIncludesAll(html, [
    'renderReadingTextComfortably',
    'appendStableReadingBlock',
    'renderedBlocks',
    'holdingBuffer',
    'reading-reveal',
    '呈現方式必須像一份完整的專業塔羅諮詢報告',
    '不要只局限在單張牌義或單一問題答案',
    '從整體能量、內在狀態、外部互動、時間節奏與可選路徑去解讀',
    '最後給建議時要像面對面聊天',
    '不要用生硬的條列式命令',
    'zoom out from individual card meanings',
    'broader energetic pattern',
    'inner state, external dynamics, timing, and possible paths',
    'When giving final guidance, sound conversational'
  ], 'comfortable reading reveal and broader lens');
  assert.ok(!html.includes('textEl.innerHTML=blocks.map'), 'streaming reveal must not rewrite the whole reading on every update');
});

test('frontend supports bilingual reading language selection and sends language to backend', () => {
  assertIncludesAll(html, [
    'reading-language',
    'Reading Language',
    'data-lang="zh"',
    'data-lang="en"',
    'TAROT_READING_LANGUAGE',
    'getReadingLanguage',
    'setReadingLanguage',
    'language:readingLanguage'
  ], 'bilingual reading language selection');
});

test('prompt contains separate professional English tarot reader instructions instead of translating Chinese', () => {
  assertIncludesAll(html, [
    'ENGLISH_SYSTEM_PROMPT',
    'Write directly in polished natural English',
    'Do not translate from Chinese',
    'calm professional tarot reader',
    'Rider-Waite-Smith',
    'Opening Insight',
    'Card-by-Card Reading',
    'Pattern Between the Cards',
    'Grounded Guidance',
    'Closing Reflection',
    'buildSystemPrompt(readingLanguage)'
  ], 'professional English tarot prompt');
});

test('removed unwanted UX remains absent: feedback panel and tone switch', () => {
  const forbidden = ['feedback-panel', 'tone-pill', 'bindToneModeUI', 'bindFeedbackUI', '讀後回饋', '解讀語氣'];
  for (const term of forbidden) {
    assert.ok(!html.includes(term), `Forbidden UX residue found: ${term}`);
  }
});

test('server serves landing page and landing HTML contains simplified punctuation-free tarot product content', () => {
  const landingPath = path.join(root, 'public/landing.html');
  assert.ok(fs.existsSync(landingPath), 'public/landing.html should exist');
  const landing = fs.readFileSync(landingPath, 'utf8');
  assertIncludesAll(server, [
    "urlPath === '/landing.html'",
    "sendPublicHtml(res, 'landing.html'",
  ], 'landing route');
  assertIncludesAll(landing, [
    'AI Assisted Tarot Reading',
    'A softer way',
    'to read within',
    'Start the Reading',
    'spiritual-tarot-art',
    'tarot-gallery',
    'gallery-card side-card',
    'data-fb',
    'tarotLandingImgFallback',
    'RWS Tarot 09 Hermit.jpg',
    'RWS Tarot 01 Magician.jpg',
    'RWS Tarot 02 High Priestess.jpg',
    'RWS Tarot 06 Lovers.jpg',
    'Wikimedia Commons',
    'botanical-pattern-layer',
    'daisy-motif',
    'clover-motif'
  ], 'landing content');
  const landingImageCount = (landing.match(/Special:FilePath\/RWS%20Tarot%20/g) || []).length;
  assert.ok(landingImageCount >= 4, `Landing should stack several tarot cards visually, found ${landingImageCount}`);
  const removedLandingTerms = ['今日适合问', '我现在真正需要面对的是什么', 'floating-note', '塔罗牌图案', 'RWS Tarot 18 Moon.jpg', 'The Moon', '三步完成一次完整解读', '为什么选择这个工具', '使用流程清晰', '少一点文字', '多一点灵性图像', '让阅读先变得舒服', '月光静心', '日光盛放', '四叶草呼吸', '适合关系与情绪', '适合行动与成长', '适合选择与转念', '先安放内在感受', '看见可用的力量', '把焦虑慢慢放下', 'healing-visual-card', 'moon-ritual-visual', 'sun-bloom-visual', 'clover-breath-visual', '真实牌图  柔和光感  安静解读', '真实牌图', '柔和光感', '安静解读', 'visual-poem', 'RWS Tarot 17 Star.jpg', 'RWS Tarot 14 Temperance.jpg', 'RWS Tarot 19 Sun.jpg', '星星牌', '节制牌', '太阳牌', '雏菊日光牌组', '进入正式占卜', 'AI 辅助塔罗解读'];
  for (const term of removedLandingTerms) {
    assert.ok(!landing.includes(term), `Removed landing template should not appear: ${term}`);
  }
  const internalProcessTerms = [
    'AI 塔罗自我觉察工作台',
    '工作台',
    '这个页面可以放什么内容',
    '它不是取代你的塔罗网站',
    '正式占卜前面的介绍页',
    '为什么要多做这个 HTML 页',
    '你的塔罗网站',
    '小工具',
    '参赛',
    '朋友圈',
    '作品集',
    'AnyGen',
    'search attempt',
    'Daisy Days Deck inspired visual direction'
  ];
  for (const term of internalProcessTerms) {
    assert.ok(!landing.includes(term), `Landing page should not expose internal process copy: ${term}`);
  }
  const forbiddenTraditional = ['塔羅', '覺察', '問題', '決定', '幫你', '進入'];
  for (const term of forbiddenTraditional) {
    assert.ok(!landing.includes(term), `Landing page should use Simplified Chinese, found: ${term}`);
  }
  const visibleText = landing
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, '');
  const forbiddenPunctuation = ['，', '。', '、', '：', '；', '？', '！', '（', '）'];
  for (const mark of forbiddenPunctuation) {
    assert.ok(!visibleText.includes(mark), `Landing visible copy should avoid Chinese punctuation: ${mark}`);
  }
});

test('mobile draw screen uses larger tappable tarot cards and compact vertical spacing', () => {
  assertIncludesAll(html, [
    'MOBILE_DRAW_BREAKPOINT',
    'mobileMaxCardHeight',
    'mobileWidthFactor',
    'mobileCenterScale',
    'stageVisualCenterY',
    'selectedCenterTop',
    '#s1{height:100svh'
  ], 'mobile draw layout');
});

test('mobile experience has premium tarot app layout treatments across cover draw and reading screens', () => {
  assertIncludesAll(html, [
    'mobile-premium-tarot-shell',
    'mobile-cover-oracle-card',
    'mobile-ritual-meta',
    'mobile-reading-panel',
    'mobile-card-spread-scroll',
    'mobile-sticky-actions',
    '100svh',
    'env(safe-area-inset-top)',
    'env(safe-area-inset-bottom)',
    'text-wrap:pretty'
  ], 'mobile premium tarot layout');
});

test('server proxies to Sub2API OpenAI-compatible chat completions and supports Vercel CORS', () => {
  assertIncludesAll(server, [
    'process.env.SUB2API_API_KEY',
    'https://api.yksa.uk/v1',
    '/chat/completions',
    'gpt-5.2',
    'Authorization',
    'ALLOWED_ORIGINS',
    'resolveCorsOrigin',
    "res.setHeader('Vary', 'Origin')",
    'convertAnthropicMessagesToOpenAI',
    'normalizeOpenAIStreamToAnthropicSSE'
  ], 'sub2api proxy');
  assert.ok(!server.includes('api.anthropic.com'), 'server should not proxy to Anthropic after Sub2API migration');
  assert.ok(!server.includes('x-api-key'), 'server should not use Anthropic x-api-key header after migration');
});

test('server ignores browser Anthropic model and always uses configured Sub2API model', () => {
  assert.ok(server.includes('model: process.env.SUB2API_MODEL || SUB2API_MODEL'), 'server should force configured Sub2API model');
  assert.ok(!server.includes('payload.model || SUB2API_MODEL'), 'server must not pass browser Anthropic model upstream');
});

test('server protects public demo usage with access code and rate limiting', () => {
  assertIncludesAll(server, [
    'process.env.ACCESS_CODE',
    'RATE_LIMIT_MAX_PER_DAY',
    'RATE_LIMIT_WINDOW_MS',
    'validateAccessCode',
    'checkRateLimit',
    'getClientIp',
    'access_code',
    '访问码不正确',
    '体验次数已用完'
  ], 'public demo protection');
});

test('frontend sends access code to backend without hardcoding the production code', () => {
  assertIncludesAll(html, [
    'TAROT_ACCESS_CODE',
    'requestAccessCode',
    'localStorage.setItem',
    'access_code',
    'Enter your private access code to begin'
  ], 'frontend access code flow');
  assert.ok(!html.includes('tarot2026'), 'production access code must not be hardcoded in HTML');
});

test('frontend uses a branded access-code modal instead of native prompt', () => {
  assertIncludesAll(html, [
    'access-modal',
    'access-card',
    'Enter the Inner Circle',
    '3 readings per network each day',
    'requestAccessCode',
    'accessInput',
    'accessSubmit',
    'aria-modal="true"'
  ], 'branded access modal');
  assert.ok(!html.includes("prompt('请输入体验码')"), 'frontend should not use native browser prompt for access code');
});

test('server can be exposed to phone on local network by configuring HOST', () => {
  assert.ok(server.includes("process.env.HOST"), 'server should support HOST env var');
  assert.ok(server.includes("0.0.0.0"), 'server should document/listen on 0.0.0.0 for LAN access');
});
