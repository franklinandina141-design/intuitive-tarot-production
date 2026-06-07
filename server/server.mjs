/**
 * Intuitive Tarot production server.
 * - Serves public/index.html
 * - Proxies /v1/messages to Sub2API's OpenAI-compatible chat completions
 * - Keeps provider API keys server-side only
 *
 * Local start:
 *   export SUB2API_API_KEY='sk-...'
 *   HOST=0.0.0.0 PORT=8790 npm start
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_HTML_FILE = 'index.html';
const HTML_PATH = path.join(PUBLIC_DIR, DEFAULT_HTML_FILE);
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const SUB2API_BASE_URL = (process.env.SUB2API_BASE_URL || 'https://api.yksa.uk/v1').replace(/\/$/, '');
const SUB2API_MODEL = process.env.SUB2API_MODEL || 'gpt-5.2';
const SUB2API_API_KEY = (process.env.SUB2API_API_KEY || '').trim().replace(/^["']|["']$/g, '');
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim().replace(/^["']|["']$/g, '');
const RATE_LIMIT_MAX_PER_DAY = Math.max(1, Number(process.env.RATE_LIMIT_MAX_PER_DAY) || 3);
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const rateLimitBuckets = new Map();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin = '') {
  return ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
}

function resolveCorsOrigin(req) {
  const origin = req.headers.origin || '';
  if (!origin) return '*';
  return isOriginAllowed(origin) ? origin : 'null';
}

function setCommonHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveCorsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function validateAccessCode(payload = {}) {
  if (!ACCESS_CODE) return true;
  const submitted = String(payload.access_code || payload.accessCode || '').trim();
  return submitted && submitted === ACCESS_CODE;
}

function checkRateLimit(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const bucket = rateLimitBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateLimitBuckets.set(ip, bucket);
  for (const [key, value] of rateLimitBuckets) {
    if (now > value.resetAt + RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(key);
  }
  return {
    allowed: bucket.count <= RATE_LIMIT_MAX_PER_DAY,
    remaining: Math.max(0, RATE_LIMIT_MAX_PER_DAY - bucket.count),
    resetAt: bucket.resetAt,
  };
}

function sendPublicHtml(res, fileName = DEFAULT_HTML_FILE, headOnly = false) {
  const safeFileName = path.basename(fileName);
  const htmlPath = path.join(PUBLIC_DIR, safeFileName);
  fs.readFile(htmlPath, 'utf8', (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      if (!headOnly) res.end(`找不到 public/${safeFileName}`);
      else res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    if (headOnly) res.end();
    else res.end(data);
  });
}

function sendHtml(res, headOnly = false) {
  sendPublicHtml(res, DEFAULT_HTML_FILE, headOnly);
}

function readRequestBody(req, onBody, onError) {
  const chunks = [];
  let total = 0;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > 2_000_000) {
      req.destroy(new Error('Request body too large'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', onError);
  req.on('end', () => onBody(Buffer.concat(chunks)));
}

function convertAnthropicMessagesToOpenAI(payload) {
  const messages = [];
  if (payload.system) {
    const systemText = Array.isArray(payload.system)
      ? payload.system.map((part) => part?.text || part?.content || '').join('\n')
      : String(payload.system || '');
    if (systemText.trim()) messages.push({ role: 'system', content: systemText });
  }

  for (const msg of payload.messages || []) {
    let content = msg.content;
    if (Array.isArray(content)) {
      content = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part.text || '';
          return part?.text || part?.content || '';
        })
        .filter(Boolean)
        .join('\n');
    }
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: String(content || ''),
    });
  }

  const model = process.env.SUB2API_MODEL || SUB2API_MODEL;
  const request = {
    model,
    messages,
    stream: payload.stream !== false,
    max_tokens: payload.max_tokens || 1400,
  };

  if (!/^gpt-5/i.test(model)) {
    request.temperature = typeof payload.temperature === 'number' ? payload.temperature : 0.8;
  }

  return request;
}

function normalizeOpenAIStreamToAnthropicSSE(upstream, res) {
  res.writeHead(upstream.statusCode || 502, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });

  let buffer = '';
  upstream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        res.write('data: [DONE]\n\n');
        continue;
      }
      try {
        const openaiChunk = JSON.parse(data);
        const text = openaiChunk?.choices?.[0]?.delta?.content || '';
        if (text) {
          res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`);
        }
      } catch {
        // Ignore malformed keepalive/event chunks.
      }
    }
  });

  upstream.on('end', () => res.end());
  upstream.on('error', (error) => {
    if (!res.headersSent) sendJson(res, 502, { error: { message: error.message } });
    else res.end();
  });
}

function proxySub2API(req, res) {
  if (!SUB2API_API_KEY || SUB2API_API_KEY === 'YOUR_SUB2API_API_KEY_HERE') {
    sendJson(res, 500, {
      error: {
        message: '服务器未设置 SUB2API_API_KEY。在终端执行：export SUB2API_API_KEY=你的key 然后重新 npm start',
      },
    });
    return;
  }

  readRequestBody(
    req,
    (body) => {
      let incoming;
      try {
        incoming = JSON.parse(body.toString('utf8') || '{}');
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON body' } });
        return;
      }

      if (!validateAccessCode(incoming)) {
        sendJson(res, 401, { error: { message: '访问码不正确 请联系网站作者获取体验码' } });
        return;
      }

      const rateLimit = checkRateLimit(req);
      if (!rateLimit.allowed) {
        sendJson(res, 429, {
          error: {
            message: '体验次数已用完 请稍后再试',
            resetAt: rateLimit.resetAt,
          },
        });
        return;
      }

      const openaiPayload = convertAnthropicMessagesToOpenAI(incoming);
      const upstreamUrl = new URL(`${SUB2API_BASE_URL}/chat/completions`);
      const upstream = https.request(
        {
          hostname: upstreamUrl.hostname,
          path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUB2API_API_KEY}`,
          },
        },
        (upRes) => {
          const contentType = String(upRes.headers['content-type'] || '');
          if (!openaiPayload.stream || !contentType.includes('text/event-stream')) {
            const chunks = [];
            upRes.on('data', (chunk) => chunks.push(chunk));
            upRes.on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              if ((upRes.statusCode || 500) >= 400) {
                res.writeHead(upRes.statusCode || 500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(raw || JSON.stringify({ error: { message: `Upstream HTTP ${upRes.statusCode}` } }));
                return;
              }
              try {
                const json = JSON.parse(raw || '{}');
                const text = json?.choices?.[0]?.message?.content || '';
                res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
                res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
              } catch {
                sendJson(res, 502, { error: { message: 'Invalid upstream response' } });
              }
            });
            return;
          }
          normalizeOpenAIStreamToAnthropicSSE(upRes, res);
        }
      );

      upstream.on('error', (error) => {
        if (!res.headersSent) sendJson(res, 502, { error: { message: error.message } });
      });

      upstream.write(JSON.stringify(openaiPayload));
      upstream.end();
    },
    (error) => sendJson(res, 400, { error: { message: error.message } })
  );
}

const server = http.createServer((req, res) => {
  setCommonHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const urlPath = (req.url || '').split('?')[0];

  if ((req.method === 'GET' || req.method === 'HEAD') && (urlPath === '/' || urlPath === '/index.html')) {
    sendHtml(res, req.method === 'HEAD');
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && urlPath === '/landing.html') {
    sendPublicHtml(res, 'landing.html', req.method === 'HEAD');
    return;
  }

  if (req.method === 'GET' && urlPath === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'intuitive-tarot',
      provider: 'sub2api-openai-compatible',
      baseUrl: SUB2API_BASE_URL,
      model: SUB2API_MODEL,
      hasApiKey: Boolean(SUB2API_API_KEY),
      allowedOrigins: ALLOWED_ORIGINS,
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/v1/messages') {
    proxySub2API(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  const shownHost = HOST === '0.0.0.0' ? 'localhost / 本机局域网IP' : HOST;
  console.log(`Intuitive Tarot 已启动：http://${shownHost}:${PORT}/`);
  console.log(`AI 解读供应商：Sub2API OpenAI-compatible (${SUB2API_BASE_URL}, model=${SUB2API_MODEL})`);
  if (HOST === '0.0.0.0') {
    console.log('局域网访问示例：在手机浏览器打开 http://你的电脑局域网IP:' + PORT + '/');
  }
  console.log(SUB2API_API_KEY ? '已检测到 SUB2API_API_KEY，可生成 AI 解读。' : '未检测到 SUB2API_API_KEY，只能浏览页面，不能生成 AI 解读。');
});
