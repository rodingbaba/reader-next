# Reader Next

[![Docker Pulls](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)](https://github.com/rodingbaba/reader-next/pkgs/container/reader-next)
[![Rust](https://img.shields.io/badge/backend-Rust-orange?logo=rust)](https://www.rust-lang.org/)
[![Vue 3](https://img.shields.io/badge/frontend-Vue%203-green?logo=vuedotjs)](https://vuejs.org/)
[![iOS](https://img.shields.io/badge/mobile-iOS%20App-lightgrey?logo=apple)](ios/)

**Reader Next** 是一个轻量、高性能且专注体验的自托管阅读与听书系统。

> 📌 **项目溯源与功能定位说明**：
> - 本项目 Fork 自 [Maple0517/reader-next](https://github.com/Maple0517/reader-next)。
> - **关于 AI 功能**：上游原有的 AI 实验性功能（章节摘要、AI 资料、AI 追赶等）目前**均未继续维护**，且不作为本项目的主线功能，**默认全部处于关闭状态**。
> - **当前主打重心**：全面专注于**「可靠稳定的服务端多端同步」**与**「极致打磨的 iOS App 沉浸式听书体验」**，让网络小说与本地电子书在手机、平板与电脑间丝滑流转。

---

## ✨ 核心特性

### 🎧 极致打磨的 iOS 听书体验
- **原生后台保活与系统锁屏控制**：集成 iOS 原生 `AVAudioSession` 与 `MediaPlayer`，锁屏与后台常驻稳定播放；支持动态封面展示、进度条精准拉动、上一句/下一句切段及耳机/车载线控。
- **句级高亮与双向进度追踪**：TTS 朗读进度与阅读器页面毫秒级联动，当前朗读句子实时高亮并平滑自动滚动，听看同步不迷失。
- **双引擎与灵活音源**：支持 iOS 系统原生高质量 TTS 音色与自定义网络 HTTP TTS（如 Edge TTS、自建声音克隆引擎等），语速、音色灵活调节。
- **智能预载与无缝衔接**：段落级智能并发预缓冲（Pre-buffering）与句间停顿消除（Gap Reduction），彻底告别断续卡顿，听书行云流水。
- **后台时长精准统计与离线回补**：息屏或后台播放时长毫秒级精准计量，网络恢复或回到前台时自动批量回补同步至服务端统计。

### 🔄 全方位服务端多端同步
- **跨端进度即时同步**：Web 端、iOS 原生混合 App、以及第三方阅读客户端（完全兼容「阅读 3.0」API 与 WebDAV）之间阅读进度毫秒级自动对齐。
- **本地书库云端化**：支持上传 TXT、EPUB、MOBI、PDF 等主流格式，服务端自动解析分卷分章并存入云端书架，多设备随处畅读。
- **离线缓存与弱网秒开**：完善的离线章节储备机制（支持多章节深度预载），断网或飞行模式下秒开本地缓存；网络自适应毫秒级探测，联网后静默自动回补。
- **跨端阅读时长统计对齐**：独创阅读统计离线持久化与服务端时长补偿合并机制，不论在线还是离线，读书与听书数据永不丢失。
- **WebDAV 云端数据备份**：支持定时或手动将书架、书源及阅读记录备份至坚果云、自建 Nextcloud 等 WebDAV 服务。

### 📚 强大兼容的书源与现代阅读器
- **阅读 3.0 书源全兼容**：完整支持 CSS Selector、XPath、JSONPath、Regex、JavaScript 规则解析，内置换源超时熔断与跨源缓存优化。
- **现代化响应式 Web 阅读器**：
  - 支持横向平移翻页、仿真翻页与纵向滚动阅读。
  - 精美排版引擎：多套内置配色与自定义主题、字体与间距无级微调。
  - 内置简繁体一键无损转换。
- **正文净化与内容替换**：支持书源级与全局内容替换规则，强力过滤防盗章节与广告垃圾文本。

### ⚡ 轻量开箱即用与极简自托管
- **超低资源开销**：后端采用 Rust (Axum + Tokio + SQLite)，内存占用极低、响应极速，单核低配 VPS 或 NAS 均可流畅运行。
- **双模式自由切换**：支持纯内网免登录即用的单用户模式，以及带邀请码与 JWT 鉴权的多用户安全模式。

---

## 🏗️ 架构与端形态

```text
┌────────────────────────────────────────────────────────┐
│                      Reader Next                       │
└────────────────────────────────────────────────────────┘
        │                                        │
        ▼                                        ▼
┌──────────────────┐                    ┌──────────────────┐
│   服务端 (Rust)   │                    │    客户端生态     │
├──────────────────┤                    ├──────────────────┤
│ • Axum + Tokio   │ ◄─── REST API ───► │ • iOS App (原生) │
│ • SQLite (SQLx)  │     /reader3/*     │   SwiftUI+Hybrid │
│ • 书源解析引擎   │ ◄─── WebDAV ─────► │ • Web (Vue 3)    │
│ • 本地书目分章   │                    │   PWA 离线缓存   │
│ • 缓存与时长统计 │                    │ • 第三方阅读生态 │
└──────────────────┘                    └──────────────────┘
```

---

## 🚀 Docker 部署

推荐使用 Docker Compose 管理部署。以下配置**默认以推荐的「纯内网单用户模式」启动**（免去注册登录流程，开箱即用，内置 `admin` 账号直接提供给第三方客户端连入）：

保存为 `docker-compose.yml`：

```yaml
services:
  reader:
    image: ghcr.io/rodingbaba/reader-next:latest
    container_name: reader-next
    restart: unless-stopped
    ports:
      - "18080:18080"
    environment:
      PUID: 1000
      PGID: 1000
      SERVER_HOST: 0.0.0.0
      SERVER_PORT: 18080
      DATABASE_URL: sqlite:/app/storage/reader.db?mode=rwc
      STORAGE_DIR: /app/storage
      ASSETS_DIR: /app/storage/assets
      WEB_ROOT: /app/web/dist
      LOG_LEVEL: info
      REQUEST_TIMEOUT_SECS: 15
      # 模式配置：默认为 false 启用单用户免登录内网模式；如需公网多用户设为 "true"
      SECURE: "false"
      SECURE_KEY: ""
      INVITE_CODE: ""
      USER_LIMIT: "50"
      USER_BOOK_LIMIT: "2000"
    volumes:
      - ./storage:/app/storage
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:18080/ >/dev/null"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s
```

启动命令：

```bash
docker compose up -d
```

启动完成后，直接在浏览器打开 `http://<服务器IP>:18080` 即可使用。

> 🔒 **如何切换为公网多用户安全模式？**  
> 若计划部署在公网环境，只需修改上述配置中的三处环境变量：
> ```yaml
>       SECURE: "true"                             # 开启安全鉴权
>       SECURE_KEY: "your-very-secure-random-key"  # 设置你的 JWT 签名密钥
>       INVITE_CODE: "your-invite-code"            # 设置注册邀请码（留空禁止自主注册）
> ```
> 修改后执行 `docker compose up -d` 重新加载容器即可。

---

## 📱 iOS 移动端编译与打包

本项目包含完整的原生与混合架构 iOS 工程（位于 `ios/` 目录），提供沉浸式听书与手势交互体验。

### 1. 混合静态资源打包

将前端 PWA 产物同步嵌入 iOS 原生工程：

```bash
# 自动编译前端并同步静态资源至 ios/ReadApp/www
./build-hybrid.sh
```

### 2. 打包未签名 IPA（用于 TrollStore / 侧载自签）

进入 `ios` 目录执行打包脚本：

```bash
cd ios
./build_unsigned_ipa.sh
```

构建产物将输出在 `ios/build/ReadApp_unsigned.ipa`，可使用 AltStore、Sideloadly 或 TrollStore 安装至 iPhone。也可直接使用 Xcode 打开 `ios/ReadApp.xcodeproj` 进行真机联调与安装。

---

## 🛠️ 本地开发环境

### 环境要求
- Rust 1.75+ (edition 2021)
- Node.js 18+ 与 npm
- Xcode 15+（如需编译 iOS 端）

### 启动流程

推荐采用单端口模式（由 Rust 服务端统一托管前端静态产物）：

```bash
# 1. 编译前端
cd frontend
npm install
npm run build
cd ..

# 2. 启动 Rust 后端服务
SERVER_PORT=18080 cargo run
```

浏览器访问 `http://localhost:18080`。

若开发前端需要 Vite 热重载调试：

```bash
cd frontend
npm run dev
# Vite 默认监听 5173 端口，并将 /reader3 API 代理到后端的 18080 端口
```

---

## ⚙️ 环境变量配置说明

系统读取根目录 `.env` 文件或容器环境变量，常见配置项如下：

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `SERVER_HOST` | `0.0.0.0` | 服务绑定地址（跨端联调需监听 `0.0.0.0`） |
| `SERVER_PORT` | `18080` | HTTP 服务监听端口 |
| `DATABASE_URL` | `sqlite:storage/reader.db?mode=rwc` | SQLite 数据库路径 |
| `STORAGE_DIR` | `storage` | 数据文件与上传资源根目录 |
| `WEB_ROOT` | `frontend/dist` | 前端静态页面托管目录 |
| `SECURE` | `false` | 是否开启安全模式（`false` 为单用户免密；`true` 为多用户认证） |
| `SECURE_KEY` | 空 | 安全模式 JWT 签名密钥 |
| `INVITE_CODE` | 空 | 新用户注册邀请码（留空禁止自主注册） |
| `USER_LIMIT` | `50` | 允许注册的最大用户数 |
| `USER_BOOK_LIMIT` | `2000` | 单个用户书架最大藏书量 |
| `LOG_LEVEL` | `info` | 日志输出级别 (`trace`/`debug`/`info`/`warn`/`error`) |
| `REQUEST_TIMEOUT_SECS` | `15` | 网络书源抓取与解析请求超时（秒） |

---

## 📂 项目结构

```text
├── src/                # Rust 后端源码
│   ├── api/            # REST API 控制器与 /reader3 路由实现
│   ├── app/            # 应用启动编排、配置读取与初始化
│   ├── crawler/        # 异步 HTTP 网络请求客户端
│   ├── model/          # 核心实体模型与 DTO 序列化
│   ├── parser/         # 书源规则引擎 (CSS/XPath/JSONPath/Regex/JS)
│   ├── service/        # 书架管理、本地书籍分章、阅读统计等业务逻辑
│   ├── storage/        # 数据库持久化与文件存储
│   └── util/           # 通用工具库与文本清洗组件
├── frontend/           # Vue 3 + Vite + Pinia 现代化响应式阅读器前端
├── ios/                # iOS 混合原生 App (SwiftUI + AVFoundation + WKWebView)
├── deploy/             # Docker Compose 部署编排文件
└── docs/               # VitePress 文档站
```

---

## 🤝 致谢与溯源

Reader Next 是一个由个人兴趣驱动并持续演进的开源项目：

- 本项目 Fork 自 [Maple0517/reader-next](https://github.com/Maple0517/reader-next)，感谢其在 Reader 现代 Web 界面与增强功能上的开拓工作。
- 基础核心派生自 [givenge/reader-rust](https://github.com/givenge/reader-rust)，感谢原作者在 Rust 阅读服务端架构上的卓越探索与奠基。
- 规则与生态参考了经典的开源阅读项目 [hectorqin/reader](https://github.com/hectorqin/reader)。
