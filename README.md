# Intuitive Tarot Production

这是一个可上线的塔罗网站项目。

当前结构：

- `public/landing.html`：塔罗网站入口介绍页
- `public/index.html`：正式抽牌与 AI 解读页
- `server/server.mjs`：Node 后端代理 `/v1/messages` 到 Sub2API
- `vercel.json`：Vercel 静态前端部署配置
- `render.yaml`：Render 后端部署配置

AI 解读使用：

- Base URL：`https://api.yksa.uk/v1`
- 接口：OpenAI-compatible `/chat/completions`
- 默认模型：`gpt-5.2`
- 后端环境变量：`SUB2API_API_KEY`

## 本机启动

```bash
cd /Users/cyauio/Documents/intuitive-tarot-production
export SUB2API_API_KEY='你的 Sub2API Key'
HOST=0.0.0.0 PORT=8790 npm start
```

电脑浏览器打开：

```text
http://127.0.0.1:8790/
```

手机同 Wi-Fi 打开：

```text
http://你的电脑局域网IP:8790/
```

## Vercel 页面 + Render 后端部署

### 1. Render 后端

在 Render 新建 Web Service：

- Runtime：Node
- Build Command：`npm install --omit=dev`
- Start Command：`npm start`
- Environment Variables：
  - `HOST=0.0.0.0`
  - `SUB2API_API_KEY=你的 Sub2API Key`
  - `SUB2API_BASE_URL=https://api.yksa.uk/v1`
  - `SUB2API_MODEL=gpt-5.2`
  - `ALLOWED_ORIGINS=*` 初期先用星号 测通后可改成你的 Vercel 域名

部署完成后记录 Render 地址，本项目当前使用：

```text
https://intuitive-tarot-production.onrender.com
```

健康检查：

```text
https://intuitive-tarot-production.onrender.com/health
```

看到 `hasApiKey: true` 说明后端可用。

### 2. Vercel 前端

在 Vercel 导入同一个 GitHub 仓库。

项目设置：

- Framework Preset：Other
- Build Command：留空或 `echo 'Static tarot frontend'`
- Output Directory：`public`

部署完成后打开入口页：

```text
https://你的项目.vercel.app/landing.html
```

正式页：

```text
https://你的项目.vercel.app/index.html
```

### 3. 连接 Vercel 前端到 Render 后端

正式页默认会请求本项目 Render 后端：

```text
https://intuitive-tarot-production.onrender.com/v1/messages
```

如果以后要临时切换其他后端，可以在浏览器控制台执行：

```js
setApiOrigin('https://你的-render-后端.onrender.com')
```

页面会自动刷新，之后 AI 解读会请求新的后端地址。

## 安全原则

- Sub2API Key 只能放在 Render 环境变量 `SUB2API_API_KEY`
- 不要把 Key 写进 `public/index.html`
- 浏览器只请求自己的后端代理
- 后端再转发到 `https://api.yksa.uk/v1/chat/completions`

## 测试

```bash
npm test
npm run check
```
