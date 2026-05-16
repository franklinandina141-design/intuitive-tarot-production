# AI Tarot Reading Web App

一个可在线访问的 AI 塔罗解读网站。用户可以输入自己的问题，抽取塔罗牌，并获得由大模型生成的个性化塔罗解读。

在线体验：

- 首页：https://intuitive-tarot-live.vercel.app/
- 正式占卜页：https://intuitive-tarot-live.vercel.app/index.html

## 项目简介

本项目是一个完整上线的 AI Web 应用，包含静态前端页面、Node.js 后端代理、AI 模型调用、真实塔罗牌图展示和线上部署。

项目目标不是简单生成随机文案，而是尝试把传统塔罗牌阵、用户问题、牌面含义和 AI 文本生成结合起来，让用户获得更自然、更有上下文的解读体验。

## 核心功能

- 塔罗网站入口介绍页
- 正式抽牌与 AI 解读页面
- 用户可输入自己的问题
- 随机抽取塔罗牌并展示真实牌图
- 根据牌阵、牌面和用户问题生成个性化解读
- 前端默认连接线上 Render 后端
- 后端代理调用 OpenAI-compatible API
- API Key 只保存在后端环境变量中，不暴露给浏览器
- 支持手机浏览器访问

## 技术栈

- HTML
- CSS
- JavaScript
- Node.js
- Vercel
- Render
- GitHub
- OpenAI-compatible API

## 项目结构

```text
.
├── public/
│   ├── landing.html      # 网站入口介绍页
│   └── index.html        # 正式抽牌与 AI 解读页
├── server/
│   └── server.mjs        # Node.js 后端代理
├── tests/
│   └── production-readiness.test.mjs
├── package.json
├── render.yaml           # Render 后端部署配置
├── vercel.json           # Vercel 静态前端部署配置
└── README.md
```

## 线上部署

### 前端

前端部署在 Vercel：

```text
https://intuitive-tarot-live.vercel.app/
```

Vercel 配置：

- Framework Preset：Other
- Build Command：`echo 'Static tarot frontend'`
- Output Directory：`public`

### 后端

后端部署在 Render：

```text
https://intuitive-tarot-production.onrender.com
```

健康检查：

```text
https://intuitive-tarot-production.onrender.com/health
```

正式页默认请求：

```text
https://intuitive-tarot-production.onrender.com/v1/messages
```

## 环境变量

后端需要配置以下环境变量：

```bash
HOST=0.0.0.0
SUB2API_API_KEY=你的 Sub2API Key
SUB2API_BASE_URL=https://api.yksa.uk/v1
SUB2API_MODEL=gpt-5.2
ACCESS_CODE=你的私密体验码
RATE_LIMIT_MAX_PER_HOUR=5
ALLOWED_ORIGINS=*
```

安全说明：

- 不要把真实 API Key 写入前端文件
- 不要提交 `.env` 文件到 GitHub
- API Key 只应放在 Render 的环境变量中
- 体验码 `ACCESS_CODE` 也只应放在 Render 环境变量中，不要写死在前端
- 在线 Demo 已开启体验码和 IP 限流，用于控制公开访问时的 API 消耗
- 浏览器只请求自己的后端代理，由后端再调用模型服务

## 本地运行

```bash
npm install
export SUB2API_API_KEY='你的 Sub2API Key'
HOST=0.0.0.0 PORT=8790 npm start
```

电脑浏览器访问：

```text
http://127.0.0.1:8790/
```

同一 Wi-Fi 下手机访问：

```text
http://你的电脑局域网IP:8790/
```

## 测试

```bash
npm test
npm run check
```

当前检查覆盖：

- 前端不暴露 provider API Key
- 前端默认连接 Render 后端
- 塔罗牌图源与 fallback 逻辑存在
- 不包含不需要的反馈表单和语气切换模块
- 后端代理使用 OpenAI-compatible chat completions
- 后端强制使用配置的模型
- 在线 Demo 访问码和 IP 限流保护存在
- 本地网络访问配置可用

## 项目亮点

- 完成了从本地开发到线上部署的完整闭环
- 前后端分离，前端部署在 Vercel，后端部署在 Render
- 使用后端代理保护 API Key，避免密钥暴露到浏览器
- 使用体验码和 IP 限流控制公开 Demo 的 API 消耗
- 支持真实用户通过手机或电脑访问
- 通过自动化测试检查生产可用性和关键安全点
- 结合 AI 文本生成与塔罗牌业务场景，形成可展示的 AI 应用作品

## 后续优化方向

- 增加更多牌阵类型
- 增强不同问题类型下的解读差异
- 优化移动端视觉细节
- 增加多语言支持
- 增加分享卡片或结果截图功能
- 增加基础访问统计与错误监控

## 免责声明

本项目生成的塔罗解读仅供娱乐、自我觉察和灵感参考，不构成医疗、法律、财务或心理专业建议。用户仍需根据自己的现实情况做出判断。
