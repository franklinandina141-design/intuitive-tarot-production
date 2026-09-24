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
    '塔罗解读仅供自我觉察与娱乐参考',
    '不能替代医疗、法律、财务或心理专业建议',
    '最终选择权仍然在你手上'
  ], 'disclaimer');
});

test('cover does not show the removed English deck label', () => {
  const visibleMarkup = html.split(/<body[^>]*>/i)[1].split('<script>')[0];
  assert.ok(!/Rider\s*[·-]?\s*Waite|Rider Waite Smith/i.test(visibleMarkup), 'removed English deck label must stay absent from the cover');
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

test('all tarot images use local RWS assets and robust SVG fallback handlers', () => {
  assertIncludesAll(html, [
    './assets/cards/',
    'function cardImageUrl',
    'function forceSvgFallback',
    'data-fb',
    'tarotImgFallback',
    'tarotReadingImgFallback',
    'decodeURIComponent(fb)',
    'markImageLoaded(el)',
    'markImageLoaded(this)',
    'svg-fallback-img',
    'class="real-card-img"'
  ], 'image fallback');
  assert.ok(!html.includes('https://commons.wikimedia.org/wiki/Special:FilePath'), 'production app must not depend on Wikimedia card images at runtime');
  assert.ok(!html.includes('<div class="csv"'), 'fallback SVG data URLs must not be rendered as text divs');
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
    '先回答用户问的事，再说明牌面依据',
    '每个抽象词后面都要跟一个现实中的行为、对话或判断标准',
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

test('server serves a simplified-Chinese landing page with local tarot imagery', () => {
  const landingPath = path.join(root, 'public/landing.html');
  assert.ok(fs.existsSync(landingPath), 'public/landing.html should exist');
  const landing = fs.readFileSync(landingPath, 'utf8');
  assertIncludesAll(server, [
    "urlPath === '/landing.html'",
    "sendPublicHtml(res, 'landing.html'",
  ], 'landing route');
  assertIncludesAll(landing, [
    'RIDER · WAITE · SMITH · 78 张牌',
    '温柔地看见',
    '你心里的答案',
    '开始抽牌',
    'spiritual-tarot-art',
    'tarot-gallery',
    'gallery-card side-card',
    'data-fb',
    'tarotLandingImgFallback',
    './assets/cards/ar09.jpg',
    './assets/cards/ar01.jpg',
    './assets/cards/ar02.jpg',
    './assets/cards/ar06.jpg',
    'botanical-pattern-layer',
    'daisy-motif',
    'clover-motif'
  ], 'landing content');
  const landingImageCount = (landing.match(/\.\/assets\/cards\/ar0[1269]\.jpg/g) || []).length;
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

test('mobile card faces load on demand instead of preloading the whole deck', () => {
  assert.ok(!html.includes('loadVisibleCardImages(stageEl)'), 'draw screen must not load all 78 face images at once');
  assert.ok(!html.includes('preloadAllImages();'), 'initial page load must not preload the whole deck on phones');
  assertIncludesAll(html, [
    'real card faces load on demand',
    'loadCardImage(img)',
    'forceSvgFallback(imgEl)'
  ], 'mobile on-demand card image loading');
});

test('reading cards request real faces immediately and clarifier status matches its state', () => {
  assertIncludesAll(html, [
    'class="real-card-img" src="${c.img}"',
    'loading="eager" decoding="async"',
    '正在为这次追问抽取澄清牌',
    'clarifier-reveal',
    'clarifierHalo',
    'clarifierLoadingMarkup',
    'clarifier-vortex',
    'clarifier-star',
    'result.innerHTML=clarifierLoadingMarkup()',
    'prefers-reduced-motion:reduce'
  ], 'reading card timing');
});

test('server hardens /health and forces reading system prompt over client system', () => {
  assertIncludesAll(server, [
    'READING_SYSTEM_PROMPT',
    "service: 'intuitive-tarot'",
    'ts: Date.now()',
    'content: READING_SYSTEM_PROMPT',
    '你是一位说话直接的塔罗陪跑者',
    'advice 只能 1 条。',
  ], 'hardened health and forced prompt');
  const healthStart = server.indexOf("urlPath === '/health'");
  const healthChunk = server.slice(healthStart, healthStart + 350);
  assert.ok(!healthChunk.includes('hasApiKey'), 'health must not expose hasApiKey');
  assert.ok(!healthChunk.includes('baseUrl'), 'health must not expose baseUrl');
  assert.ok(!healthChunk.includes('SUB2API_MODEL'), 'health must not expose model');
  assert.ok(!healthChunk.includes('allowedOrigins'), 'health must not expose allowedOrigins');
  assert.ok(server.includes("messages.push({ role: 'system', content: READING_SYSTEM_PROMPT })"), 'must force server system');
  assert.ok(!/if \(payload\.system\)/.test(server), 'must not branch on client system');
});

test('server proxies to Sub2API OpenAI-compatible chat completions and supports Vercel CORS', () => {
  assertIncludesAll(server, [
    'process.env.SUB2API_API_KEY',
    'https://api.yksa.uk/v1',
    '/chat/completions',
    'gpt-5.6-sol',
    'SUB2API_FALLBACK_MODELS',
    'gpt5',
    'Content-Length',
    'User-Agent',
    'RETRYABLE_UPSTREAM_STATUSES',
    'isRetryableUpstreamError',
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
  assertIncludesAll(server, [
    "process.env.SUB2API_MODEL || 'gpt-5.6-sol'",
    "['gpt-5.2', 'gpt-5.5', 'gpt5'].includes(configuredSub2ApiModel)",
    "? 'gpt-5.6-sol'",
    'function convertAnthropicMessagesToOpenAI(payload, model = SUB2API_MODEL)',
    'model,',
  ], 'configured Sub2API model');
  assert.ok(!server.includes('payload.model || SUB2API_MODEL'), 'server must not pass browser Anthropic model upstream');
  assert.ok(!server.includes('const model = process.env.SUB2API_MODEL || SUB2API_MODEL'), 'request conversion must use normalized model');
});

test('server protects the open demo with IP rate limiting only', () => {
  assertIncludesAll(server, [
    'RATE_LIMIT_MAX_PER_DAY',
    'RATE_LIMIT_WINDOW_MS',
    'peekRateLimit',
    'checkRateLimit(req);',
    'getClientIp',
    '当前公开体验次数已用完'
  ], 'public demo rate limiting');
  assert.ok(!server.includes('codeStatus'), 'server should not keep access-code gate logic');
  assert.ok(!server.includes('access_code'), 'server should not require access codes');
});

test('frontend keeps reading generation open without an access-code gate', () => {
  assert.ok(!html.includes('TAROT_ACCESS_CODE'), 'frontend should not store access codes');
  assert.ok(!html.includes('ensureAccessCode'), 'frontend should not ask for access codes');
  assert.ok(!html.includes('access_code'), 'frontend should not send access codes');
  assert.ok(!html.includes('PURCHASE_CONFIG'), 'frontend should not show purchase links before monetization is ready');
});

test('frontend keeps the open demo flow free of native prompts', () => {
  assert.ok(!html.includes('codeGate'), 'access modal DOM should be removed');
  assert.ok(!html.includes("prompt('请输入体验码')"), 'frontend should not use native browser prompt for access code');
});

test('frontend includes professional spreads and clarifier follow-up', () => {
  assertIncludesAll(html, ['const SPREADS=', 'readerBrief', 'data-spread="relationship"', 'data-spread="work"', 'followup-panel', 'generateFollowUp', '简体中文', '删掉不承担信息的副词'], 'spread and follow-up UX');
});

test('server can be exposed to phone on local network by configuring HOST', () => {
  assert.ok(server.includes("process.env.HOST"), 'server should support HOST env var');
  assert.ok(server.includes("0.0.0.0"), 'server should document/listen on 0.0.0.0 for LAN access');
});

test('server serves bundled tarot card assets for local phone testing', () => {
  assertIncludesAll(server, [
    'CONTENT_TYPES',
    'sendPublicStatic',
    "['.jpg', 'image/jpeg']",
    'fs.createReadStream(filePath).pipe(res)',
    "'public, max-age=86400'"
  ], 'local card asset serving');
});
