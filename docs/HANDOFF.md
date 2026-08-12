# OBS 音频检测助手 — 项目交接文档 (HANDOFF)

> **最后更新**：2026-08-12（v3.9.7，客户端可靠性与服务端状态保护优化）
>
> **这份文档写给谁**：包括刚入门的程序员。看不懂技术名词？每一章都有「基础概念」小节，先看那里。整份文档可以当作「教程 + 参考手册」使用。
>
> **怎么读**：第一次接触 → 按顺序通读第 0~3 章建立整体认知，然后跳到第 11 章跟着做一次部署；要改代码 → 精读第 5、6 章；要排查问题 → 第 14 章。

---

## 目录

- [第 0 章 前置知识清单](#第-0-章-前置知识清单)
- [第 1 章 项目是什么](#第-1-章-项目是什么)
- [第 2 章 技术栈入门](#第-2-章-技术栈入门)
- [第 3 章 整体架构](#第-3-章-整体架构)
- [第 4 章 代码仓库结构](#第-4-章-代码仓库结构)
- [第 5 章 客户端深潜（Electron 桌面端）](#第-5-章-客户端深潜electron-桌面端)
- [第 6 章 服务器深潜（remote-server）](#第-6-章-服务器深潜remote-server)
- [第 7 章 开发环境搭建（从零开始）](#第-7-章-开发环境搭建从零开始)
- [第 8 章 测试](#第-8-章-测试)
- [第 9 章 构建与打包](#第-9-章-构建与打包)
- [第 10 章 发布流程（GitHub Actions）](#第-10-章-发布流程github-actions)
- [第 11 章 服务器部署全流程](#第-11-章-服务器部署全流程)
- [第 12 章 服务器运维](#第-12-章-服务器运维)
- [第 13 章 网络与公网访问](#第-13-章-网络与公网访问)
- [第 14 章 常见问题排查](#第-14-章-常见问题排查)
- [第 15 章 安全注意事项](#第-15-章-安全注意事项)
- [第 16 章 术语表](#第-16-章-术语表)
- [第 17 章 给新人的学习路线](#第-17-章-给新人的学习路线)
- [附录 A 命令速查表](#附录-a-命令速查表)
- [附录 B 本次部署记录](#附录-b-本次部署记录)

---

## 第 0 章 前置知识清单

这份项目混合了**桌面应用（Electron）** 和 **Web 服务（Node.js + Docker）**。如果你是入门程序员，先确认自己认识以下概念（不认识就在搜索引擎查一下，每个 10 分钟就能懂）：

| 概念 | 一句话解释 | 本项目的用处 |
|---|---|---|
| JavaScript / TypeScript | JS 是浏览器语言，TS 是加了类型检查的 JS | 全部代码都用 TS（服务器部分用 JS） |
| Node.js | 能在服务器/电脑上运行 JS 的运行时 | Electron 主进程和服务器都靠它 |
| npm | Node 的包管理器，`npm install` 装依赖 | 管理第三方库 |
| 命令行（终端） | 输入命令操作电脑 | 几乎每一步都要用 |
| Git / GitHub | 代码版本管理 + 远程托管 | 代码在 GitHub 上 |
| HTTP | 网页请求的协议（GET/POST/状态码） | 服务器 API 都是 HTTP |
| WebSocket | HTTP 升级来的全双工长连接，双向实时推送 | 电脑→服务器的状态上报 |
| JSON | 一种通用数据格式 `{"key": "value"}` | 前后端数据交换格式 |
| Docker | 把程序+环境打包成容器的工具 | 服务器用容器跑 |
| 数据库 | 存储数据的地方 | 本项目**不用数据库**，用 JSON 文件 |

> 💡 **本项目最大的「反直觉点」**：服务器**没有用数据库**，所有数据存在一个 `remote-state.json` 文件里。不要试图找数据库——没有。

---

## 第 1 章 项目是什么

### 1.1 要解决的问题

直播时，**画面正常但麦克风没声音**是很难第一时间发现的。常见原因：无线麦没电、静音键误触、接收器断连、声卡路由异常、OBS 音源选错。

这个问题靠人盯很难，所以做了一个**自动检测工具**：

```
麦克风没声音 ──► 检测软件发现电平持续过低 ──► 弹窗报警 + 声音提示 ──► 现场人员处理
```

### 1.2 三个组成部分

| 部分 | 运行在哪里 | 干什么 |
|---|---|---|
| **桌面客户端** | 每台直播电脑上（Windows/macOS） | 连接 OBS 和 ATEM，实时检测，本地弹窗报警 |
| **远程服务器** | 一台内网服务器（`192.168.110.111`） | 汇总所有直播间的状态，提供网页监控和管理 |
| **手机监看** | 手机浏览器 | 审批通过后只读查看某个直播间的音频/机位状态 |

### 1.3 一次典型直播的完整链路

```
1. 导播打开电脑 → 桌面客户端自动启动
2. 客户端连上 OBS（WebSocket，端口 4455）
3. 开播 → 客户端开始检测目标音源电平
4. 主播麦克风没电 → 电平持续低于阈值
5. 静音 90 秒（75%）→ 屏幕出现预警浮窗
6. 静音 120 秒 → 弹窗报警 + 循环提示音
7. 导播点「确定」→ 计时清零重新开始
8. 整个过程客户端每 400ms 向服务器上报摘要
9. 管理员打开 /monitor 网页，能看到这个直播间"正在报警"
10. 若开启了企业微信机器人 → 群里收到报警消息
```

---

## 第 2 章 技术栈入门

> 如果你已经懂这些技术，直接跳到第 3 章。这里用最直白的话解释「为什么用这些东西」。

### 2.1 Electron —— 用网页技术做桌面软件

Electron 让开发者用 **HTML/CSS/JS** 写桌面应用。它内部其实是：
- 一个 **Chromium 浏览器内核**（渲染界面）
- 一个 **Node.js 运行时**（操作文件、网络、系统）

**两个进程的概念是整个项目的地基**：

```
┌────────────────────────── Electron 应用 ──────────────────────────┐
│                                                                    │
│  ┌─────────────────────┐        ┌─────────────────────────────┐   │
│  │  主进程 (main)       │        │  渲染进程 (renderer)          │   │
│  │  · Node.js 环境      │  IPC   │  · Chromium 浏览器环境        │   │
│  │  · 能读写文件/网络    │ ◄────► │  · 只能显示界面和发请求       │   │
│  │  · 连接 OBS/ATEM     │        │  · 不能直接碰系统资源         │   │
│  └─────────────────────┘        └─────────────────────────────┘   │
│           ▲                                 ▲                     │
│           │ 主进程是"大脑"                     │ 渲染进程是"脸"      │
└───────────┴─────────────────────────────────┴─────────────────────┘
```

- **主进程**（`src/main/`）：干所有脏活累活——连 OBS、连 ATEM、读写配置、管理窗口、检查更新。
- **渲染进程**（`src/renderer/`）：只管画界面，用户点击按钮 → 通过 IPC 请求主进程干活。
- **IPC**（Inter-Process Communication，进程间通信）：两者对话的通道。本项目用 `ipcMain.handle()`（主进程注册接口）和 `ipcRenderer.invoke()`（渲染进程调用接口）。

### 2.2 React —— 界面的「组装工厂」

React 用组件（Component）拼界面。每个组件是一个函数，接收数据（props）返回界面描述。状态变了界面自动更新。

本项目 React 19，典型组件流：

```
用户点按钮 ──► onChange 回调 ──► updateDraft 更新本地状态
  ──► useAutoSave 节流 420ms 后调用 saveConfig (IPC)
  ──► 主进程写盘并广播新快照 ──► 所有窗口收到新 snapshot ──► 界面刷新
```

### 2.3 Vite —— 构建工具

Vite 负责把 TSX 代码编译成浏览器能跑的文件。开发时提供热更新（改代码界面即时刷新），打包时产出优化后的静态文件。

### 2.4 TypeScript —— 带类型的 JS

给 JS 加类型标注，IDE 能提前发现错误。本项目 `strict` 模式全开——**不要用 `as any`、`@ts-ignore` 跳过类型检查**，这是硬性约定。

### 2.5 Node.js + Docker —— 服务器的运行方式

服务器代码（`remote-server/`）是纯 Node.js，没有用 Express 等框架，直接用 Node 自带的 `http` 模块写 HTTP 服务。Docker 把它打包成镜像，在任何机器上运行结果一致。

### 2.6 关键第三方库

| 库 | 作用 |
|---|---|
| `obs-websocket-js` | 与 OBS 通信的官方 JS 客户端库 |
| `atem-connection` | 与 Blackmagic ATEM 导播台通信（Bitfocus 出品） |
| `electron-updater` | 自动更新（检查/下载/安装新版本） |
| `ws` | Node 端的 WebSocket 库（服务器用） |
| `lucide-react` | 图标库 |
| `yaml` | 解析 `latest.yml` 更新描述文件（服务器用） |

---

## 第 3 章 整体架构

### 3.1 总览图

```
┌──────────────────────────────────────────────────────────────┐
│                   直播电脑 (Windows / macOS)                    │
│                                                                │
│   OBS (WebSocket :4455) ──┐                                    │
│   ATEM (UDP :9910)  ──────┼─► Electron 主进程                  │
│                            │     │                             │
│                            │  IPC │  preload (白名单桥接)      │
│                            │     ▼                             │
│                            │  React UI (渲染进程)              │
│                            │                                   │
│   RemoteBridge (WebSocket) ┘  状态摘要 400ms / 电平 80ms        │
└──────────────────────────────────────────────────────────────┘
                             │  LAN:  http://192.168.110.111:8088
                             │  公网:  https://obs.huaweilive.top:8088
                             ▼
┌──────────────────────────────────────────────────────────────┐
│              远程监控服务器 (Ubuntu + Docker)                   │
│                                                                │
│  obs-audio-remote 容器 (:8088)                                 │
│    ├─ /monitor      集中监控网页（唯一管理主界面）                │
│    ├─ /api/*        REST API（注册/审批/管理命令）               │
│    ├─ /ws/desktop   桌面状态 WebSocket                          │
│    ├─ /ws/mobile    手机监看 WebSocket                          │
│    ├─ /updates      内部更新缓存下载                             │
│    ├─ /complaint    客诉系统反向代理（保留约定，勿删）            │
│    └─ 数据: data/remote-state.json  +  updates/ 缓存包         │
│                                                                │
│  complaint-tool 容器 (:8010) —— 独立客诉系统，勿动              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 三个互相独立的子系统

| 子系统 | 触发方式 | 是否默认启用 | 边界 |
|---|---|---|---|
| **集中监控** | 电脑填写直播间名称后自动上报 | ✅ 始终启用 | 与手机访问无关，关手机访问不影响它 |
| **手机监看** | 电脑端开启「手机扫码监看」（需开发者模式） | ❌ 默认关闭 | 只读，不允许远程切 ATEM |
| **客诉系统** | `/complaint` 反向代理到 complaint-tool | ✅ 独立 | 是另一套系统，本仓库只是代理 |

### 3.3 数据流总览（一个快照的一生）

```
OBS 每 40ms 推送一次电平数据（InputVolumeMeters 事件）
  │
  ▼
OBSMonitor.updateInputLevel()
  │  平滑电平（attack 45ms / release 170ms）
  │  判断是否超过阈值（带 1.5dB 迟滞防抖）
  │  超过 → 记「正在讲话」；低于 → 开始累计静音
  ▼
recomputeAggregateState()  ← 每秒一次（tickTimer）
  │  多路音源取「最早开始静音」的那一路
  │  静音 ≥ 120 秒 → alertVisible = true
  ▼
emit('snapshot')  ──►  main.ts 收到
  │                    │
  │   injectATEMState() 合并 ATEM 状态
  │   preserveSnapshotHistory() 保留音量历史
  ▼
broadcastSnapshot()  ──► 所有窗口收到 ──► React 界面更新
  │
  └─► remoteBridge.updateSnapshot() ──► 服务器 WebSocket
        （400ms 节流）
```

### 3.4 「状态机」—— 整个程序的心跳

客户端用一套**有限状态机**描述当前状态（`shared/silenceState.ts`）：

```
disconnected ──► connecting ──► idle_not_streaming ──► monitoring
                                                     │
                          silent_counting ◄───────────┤ (开始静音)
                          │
                     pre_alert (静音≥75%时长)
                          │
                      alerting (静音≥100%时长 → 弹窗)
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
         acknowledge (确定)          pause (暂停检测)
         → 重新计时                  → 关闭检测
```

状态值定义在 `src/shared/types.ts` 的 `MonitorStatus`。**核心原则：所有状态转换是纯函数，不依赖外部副作用，所以可以单测**（见第 8 章）。

---

## 第 4 章 代码仓库结构

```
OBS音频检测/                        # 仓库根目录
│
├── src/                            # ═══ 桌面客户端源码 ═══
│   ├── main/                       # 主进程（Node 环境）
│   │   ├── main.ts                 # 【入口】窗口管理/IPC注册/托盘/更新/ATEM会话（2906行，最大文件）
│   │   ├── obsMonitor.ts           # OBS 连接 + 电平采集 + 多音源状态机（1148行）
│   │   ├── ATEMMonitor.ts          # ATEM 连接 + 机位计时 + 局域网扫描（1036行）
│   │   ├── RemoteBridge.ts         # 与远程服务器的注册/WebSocket/状态上报（682行）
│   │   ├── configStore.ts          # 配置读写 + 清洗 + 密码加密 + 版本迁移
│   │   ├── preflightCheck.ts       # 开播检查：进程识别、启动应用、恢复窗口位置
│   │   ├── preflightDiscovery.ts   # 开播应用自动发现（Windows：注册表/快捷方式）
│   │   ├── windowsWindowManager.ts # Windows 原生窗口操作（PowerShell 调用）
│   │   ├── historyStore.ts         # 报警历史存储（最近20条）
│   │   ├── atemHistoryStore.ts     # ATEM 切换历史（最近200条）
│   │   ├── ATEMSessionStore.ts     # 直播场次统计（最近10场）
│   │   ├── pendingUpdateStore.ts   # 待安装更新的登记（重启后恢复安装）
│   │   ├── preload.cts             # 渲染进程的白名单 IPC 桥（安全边界！）
│   │   └── display.ts              # 枚举显示器信息
│   │
│   ├── renderer/                   # 渲染进程（浏览器环境，React）
│   │   ├── main.tsx                # 入口：按 hash 路由渲染不同界面（1053行）
│   │   ├── ipc.ts                  # window.obsGuard 的类型声明
│   │   ├── components/             # 各类界面组件
│   │   │   ├── SettingsPanel.tsx   # 设置弹窗（5个分区：设备/规则/提醒/系统/维护）
│   │   │   ├── settings/           # 设置各分区的内容组件
│   │   │   │   ├── SettingsSections.tsx  # 所有设置分区（OBS连接/ATEM/音源/规则/...）
│   │   │   │   ├── SourcePicker.tsx      # 音源选择下拉框
│   │   │   │   └── widgets.tsx           # 数字输入框/开关/分段控件
│   │   │   ├── AlertApp.tsx        # 报警弹窗
│   │   │   ├── AlertBackdropApp.tsx# 全屏红边背景层
│   │   │   ├── FloatingApp.tsx     # 小浮窗（音频/音频+机位/多功能）
│   │   │   ├── PreAlertApp.tsx     # 预警浮窗
│   │   │   ├── ToastAlertApp.tsx   # 轻量 toast 报警
│   │   │   ├── PreflightCheckPage.tsx # 开播检查页面
│   │   │   ├── OnboardingWizard.tsx   # 首次启动引导向导（6步）
│   │   │   ├── Sidebar.tsx         # 左侧导航栏
│   │   │   ├── TopBar.tsx          # 顶栏（搜索/保存状态/更新铃铛）
│   │   │   ├── StatusBanner.tsx    # 状态横幅
│   │   │   ├── LevelMeter.tsx      # 实时电平表（可拖动调阈值）
│   │   │   ├── QuickActions.tsx    # 快速操作卡片
│   │   │   ├── HistoryList.tsx     # 报警历史列表
│   │   │   ├── StyledSelect.tsx    # 自定义下拉选择
│   │   │   ├── dialogs/            # GuideDialog(引导)/ManualDialog(说明书)/ReleaseNotesDialog(更新说明)
│   │   │   └── widgets/            # ConnectionStatusCard/HistoryCalendar/ProductivityChart
│   │   ├── hooks/                  # React 自定义 Hook
│   │   │   ├── useSnapshot.ts      # 订阅主进程快照
│   │   │   ├── useAudioMeter.ts    # 订阅电平帧（rAF 节流）
│   │   │   ├── useAutoSave.ts      # 420ms 节流自动保存
│   │   │   └── useUpdateState.ts   # 订阅更新状态
│   │   ├── utils/                  # 纯工具函数
│   │   │   ├── status.ts           # 状态文字/色调/百分比换算
│   │   │   ├── alertSound.ts       # Web Audio 提示音合成
│   │   │   └── appVersion.ts       # 版本号（Vite 注入）
│   │   └── styles/                 # CSS（tokens.css 定义全部颜色变量，其余分模块）
│   │
│   └── shared/                     # ═══ 主进程和渲染进程共享 ═══
│       ├── types.ts                # 【核心】全部 TypeScript 类型 + DEFAULT_CONFIG
│       ├── silenceState.ts         # 静音状态机（纯函数，最重要最可测）
│       ├── audio.ts                # 电平换算（乘数→dB）+ 平滑算法
│       ├── reminderTiming.ts       # 报警时长常量 + 进度/颜色计算
│       ├── inputKinds.ts           # 判断音源是否可能有声音
│       ├── preflight.ts            # 开播检查的进程匹配（跨平台）
│       ├── windowPlacement.ts      # 窗口位置归一化保存/恢复
│       ├── atemPalette.ts          # ATEM 机位的莫兰迪色板
│       ├── latestTaskQueue.ts      # 「只跑最新任务」的并发队列
│       └── reconnect.ts            # 指数退避重连延迟计算
│
├── remote-server/                  # ═══ 远程监控服务器（独立 npm 包）═══
│   ├── src/
│   │   ├── server.mjs              # 【入口】HTTP+WebSocket 服务、全部 API（1440行）
│   │   ├── update-cache.mjs        # 更新缓存：下载、SHA-512 校验、保留2版
│   │   └── wecom-notifier.mjs      # 企业微信通知：去重、批量合并、退避重试
│   ├── public/                     # 静态网页（原生 JS，无框架）
│   │   ├── monitor.html + assets/monitor.js   # 集中监控（唯一管理主界面）
│   │   ├── mobile.html + assets/mobile.js     # 手机监看 + 画中画
│   │   ├── admin.html + assets/admin.js       # 已废弃（/admin 自动跳转 /monitor）
│   │   └── assets/                 # app.css + 画中画视频文件
│   ├── test/                       # node:test 25 项
│   ├── Dockerfile                  # 容器镜像定义
│   ├── docker-compose.yml          # 容器编排（端口/挂载/安全）
│   ├── COMPLAINT_PROXY.md          # 客诉代理保留约定（改代码前必读！）
│   └── package.json                # 服务器自己的依赖（仅 ws + yaml）
│
├── test/                           # 客户端 vitest 119 项测试
├── docs/
│   ├── HANDOFF.md                  # 本文件
│   ├── 远程访问服务部署.md          # 部署精简版
│   └── ATEM_导播台集成开发文档.md   # ATEM 功能设计文档
├── scripts/                        # 辅助脚本
│   ├── clean.mjs                   # 清空 dist
│   ├── package-win-portable.mjs    # 打 Windows 便携版
│   ├── render-icons.cjs            # 从 SVG 生成全部图标
│   └── generate-pip-video.swift    # 生成手机画中画演示视频
├── build/                          # 图标/字体/安装器资源
└── .github/workflows/windows-build.yml  # CI/CD 自动构建发布
```

---

## 第 5 章 客户端深潜（Electron 桌面端）

### 5.1 启动流程（main.ts 从上到下）

```
1. 解析启动参数（--autostart-preflight 开机自启直接进开播检查）
2. 创建 ConfigStore 加载配置（config.json）
3. 处理开机自启设置同步
4. 创建核心对象：
     OBSMonitor(配置, 显示器)   → 连 OBS
     ATEMMonitor()              → 连 ATEM
     RemoteBridge(版本)         → 连远程服务器
     PreflightCheckService()    → 开播检查
     PendingUpdateStore()       → 待装更新
5. 注册全部 IPC 接口（registerIpc）
6. 初始化更新器（initializeUpdater）
7. 创建主窗口 / 托盘
8. 监听显示器变化
9. monitor.start() 开始连接 OBS
```

### 5.2 IPC 通道全表（preload.cts ↔ main.ts）

> 渲染进程不能直接调用主进程，必须走这些白名单接口。**新增功能也要在这里加**，这是安全边界。

| 渲染进程调用 | IPC 通道 | 作用 |
|---|---|---|
| `getSnapshot()` | `snapshot:get` | 拉取当前完整快照 |
| `saveConfig(patch)` | `config:save` | 保存配置（自动处理房间名修订号等） |
| `resetConfig()` | `config:reset` | 恢复出厂设置 |
| `refreshInputs()` | `inputs:refresh` | 重新读取 OBS 音源列表 |
| `reconnect()` | `obs:reconnect` | 重连 OBS |
| `testConnection(patch)` | `obs:test-connection` | 测试 OBS 连接 |
| `setPaused(b)` | `monitor:set-paused` | 暂停/恢复检测 |
| `setSimulatedLive(b)` | `monitor:set-simulated-live` | 模拟开播（测试用） |
| `testAlert()` | `alert:test` | 测试报警弹窗 |
| `alertAction(action)` | `alert:action` | 处理报警（确定/单次忽略） |
| `forceCloseAlert()` | `alert:force-close` | 强制关闭报警 |
| `dismissPreAlert()` | `prealert:dismiss` | 关闭当前预警 |
| `setFloatingWindowVisible(b)` | `floating:set-visible` | 开关小浮窗 |
| `showSettings()` | `settings:show` | 显示主窗口 |
| `listHistory()` / `clearHistory()` | `history:list` / `history:clear` | 报警历史 |
| `updateAlertPosition()` | `alert:position-updated` | 记住报警窗口位置 |
| `getDisplays()` | `displays:get` | 显示器列表 |
| `getUpdateState()` | `update:get-state` | 更新状态 |
| `checkForUpdates()` / `downloadUpdate()` / `installUpdate()` | `update:check` / `update:download` / `update:install` | 更新操作 |
| `checkPreflightApps()` | `preflight:check` | 检查开播应用 |
| `launchPreflightApps()` / `launchPreflightApp()` | `preflight:launch-all` / `preflight:launch` | 一键启动/单个启动 |
| `discoverPreflightApps()` | `preflight:discover` | 自动发现应用 |
| `capturePreflightLayout()` | `preflight:capture-layout` | 保存窗口布局 |
| `openPreflightProjector()` | `preflight:open-projector` | 打开 OBS 节目投影 |
| `pickPreflightTarget()` | `preflight:pick-target` | 选择程序文件 |
| `onSnapshot(cb)` | `snapshot`（推送） | 订阅快照 |
| `onMeter(cb)` | `meter:update`（推送） | 订阅电平帧 |
| `onUpdateState(cb)` | `update:state`（推送） | 订阅更新状态 |
| `getATEMState()` / `clearATEMHistory()` | `atem:get-state` / `atem:history-clear` | ATEM 状态/历史 |
| `changePreviewInput()` / `autoTransition()` / `changeProgramInput()` | `atem:change-preview-input` / `atem:auto-transition` / `atem:change-program-input` | 切台 |
| `testATEMConnection()` / `scanATEMNetwork()` / `atemReconnect()` | `atem:test-connection` / `atem:scan-network` / `atem:reconnect` | ATEM 连接/扫描 |

### 5.3 OBSMonitor 详解（obsMonitor.ts）

**职责**：连接 OBS，订阅电平，维护每路音源的独立状态。

**关键常量**：

| 常量 | 值 | 含义 |
|---|---|---|
| `METER_STALE_MS` | 5000 | 超过 5 秒没收到电平 → 视为数据过期 |
| `VOLUME_HISTORY_RETENTION_MS` | 10 分钟 | 音量历史保留时长 |
| `VOLUME_HISTORY_SAMPLE_MS` | 500ms | 音量历史采样间隔 |
| `METER_SNAPSHOT_THROTTLE_MS` | 1000ms | 快照推送节流（避免每秒刷 4 次界面） |
| `METER_FRAME_INTERVAL_MS` | 40ms | 电平帧推送间隔（25fps） |
| `AUDIBLE_CONFIRM_MS` | 120ms | 确认「在讲话」需要电平持续超过阈值 120ms |
| `THRESHOLD_HYSTERESIS_DB` | 1.5dB | 迟滞：已在讲话时阈值降 1.5dB，避免边界抖动 |

**核心方法逐个解释**：

```
connect()             → 创建 OBSWebSocket，连接，注册事件订阅
loadInputs()          → GetInputList 拉音源，过滤掉纯视觉源（isProbablyAudibleInputKind）
pollOutputState()     → 每 5 秒轮询 GetStreamStatus/GetRecordStatus/GetVirtualCamStatus
onInputVolumeMeters() → 电平事件核心处理：
                          · 只处理被选中的目标音源
                          · maxInputLevelDb() 取各通道峰值（忽略 peak-hold）
                          · updateInputLevel() 平滑 + 判断静音
updateInputLevel()    → 每路音源独立：
                          · levelDb > 阈值+迟滞 → 记「说话」，清静音计时
                          · levelDb ≤ 阈值     → 开始/继续静音计时
recomputeAggregateState() → 聚合所有目标音源：
                          · 取最早开始静音的那一路作为「活动报警源」
                          · 静音 ≥ 120s → alertVisible = true，发出 alert 事件
startSilenceEvent()   → 记录一次静音事件（监控面板用）
finishSilenceEvent()  → 声音恢复时补全事件时长
handleAlertAction()   → 确定=清零重计；单次忽略=延后5分钟
getSnapshot()         → 组装 AppSnapshot（界面/上报都靠它）
```

**说话判定算法**（防止误报的核心）：

```
阈值 = 配置阈值 ± 1.5dB（正在说话时放宽）
如果 电平 > 阈值 持续 120ms：
    → 确认在说话，记 lastAboveThresholdAt
    → 只要 3 秒内有说话记录，audioSpeaking = true（容忍短暂换气停顿）
否则：
    → 开始静音计时
```

### 5.4 ATEMMonitor 详解（ATEMMonitor.ts）

**职责**：连接 ATEM 导播台（UDP 9910），显示 PGM/PVW，机位停留计时。

**关键逻辑**：

```
连接：Atem.connect(host, 9910)，库自带 5s 握手，本程序 9s 超时兜底
状态：stateChanged 事件 → updateStateFromATEM()
   · 读取 mixEffects[0].programInput / previewInput
   · 只保留 CAM1-8、彩条、Color、Media Player 信号源（usableATEMInputs）

机位计时：
   · 仅 liveActive（直播/录制/模拟/虚拟摄像头）时计时
   · programInput 变化 → 记录切换历史（switchRecorded 事件）
   · programInputStartedAt = 开始计时的时间戳
   · elapsedSeconds ≥ 600（10分钟）→ programInputOverLimit
   · 出镜机位（atemPrimaryInputIds）→ 豁免，不计时不提醒

报警分层：
   · cameraPreAlertVisible    → 距上限 60 秒内（上限的 25% 提前量）
   · cameraAlertVisible       → 10 分钟（小浮窗红色 / 企业微信推送）
   · cameraFullscreenAlertVisible → 12 分钟（电脑端强提醒弹窗）

局域网扫描（scanNetwork）：
   1. buildCandidateHosts()：种子IP网段 /24 + 网卡各网段（常见主机位优先，大网段抽样）
   2. probeATEMHosts()：UDP hello 广播 + 逐台探测（两轮，每批48台，防丢包）
   3. 对 ARP 表邻居用真实握手二次确认（限 8 并发、128 台）
```

### 5.5 RemoteBridge 详解（RemoteBridge.ts）

**职责**：让电脑成为服务器上的一个「在线设备」。

```
configure(config)     → 读取服务器地址/直播间名称/UUID/密钥，触发连接
connect()             → 候选线路并行尝试（Promise.any）：
                          线路1 = 局域网 http://192.168.110.111:8088（2.5s 超时）
                          线路2 = 公网 https://obs.huaweilive.top:8088（8s 超时）
                       任一成功即用该线路，其余 abort
registerWithServer()  → POST /api/devices/register 带 UUID+secret 注册
openSocket()          → 建立 WebSocket（/ws/desktop?uuid=..&secret=..）
   · 若系统配置了代理 → 走 ProxyAgent
updateSnapshot()      → 节流 400ms 发送状态摘要（remoteTelemetry 裁剪字段）
updateMeter()         → 节流 80ms 发送电平帧（仅手机监看用）
消息处理：
   · registered / device-config → 可能更新直播间名称（revision 冲突保护）
   · presence / latency-pong / state-ack → 更新在线状态/延迟/同步时间
   · admin-command → 执行远程管理命令并回执
applyServerRoomName() → 服务器改名的同步（revision 高的赢）
```

**为什么叫「摘要」**：上报前用 `remoteTelemetry()` 裁剪——只发 OBS 状态、音频电平、ATEM 机位、版本号等必要字段，**绝不发** OBS 密码、完整配置、历史记录。

### 5.6 configStore 详解（configStore.ts）

**配置保存流程**：

```
saveConfig(patch) → enqueueWrite()
  → normalize() 清洗所有字段（clamp 数值、过滤非法、去重）
  → obsPassword 处理：
       rememberObsPassword=true  → safeStorage 加密，存 "safe:base64"
       false                     → 存 "plain:base64"（仅本次运行）
  → 原子写入 config.json（临时文件+rename，防写一半）
```

**版本迁移**（load 时自动执行）：

| 触发条件 | 迁移动作 |
|---|---|
| 旧版 `floatingWindowLayoutVersion` | 重置浮窗尺寸（布局改了） |
| 旧版 `preflightConfigRevision` | 重置开播检查配置（发现模型换了） |
| 旧版 `monitoringIdentityRevision` | 重置直播间名称（v3.9.1 改一对一直播间模型） |
| 旧版 `atemCameraTimeLimitSeconds` 值 | 统一为 600 秒（10 分钟） |

**身份生成**：首次运行 `randomUUID()` 生成设备 UUID，`randomBytes(32)` 生成密钥，之后一直保存——服务器靠它识别这台电脑。

### 5.7 窗口管理（main.ts 后半部分）

```
createSettingsWindow()  → 主窗口 975×749，关闭=隐藏（托盘常驻）
showFloatingWindow()    → 小浮窗：无边框、透明、置顶
   · 三种模式：audio（固定宽高比）/ audio_atem / multifunction
   · Windows 用 setShape 做圆角（逐像素矩形）
showAlertWindows()      → 报警窗：按 alertDisplayMode 选屏
   · primary / display_id / all
   · 记住上次位置（alertPositions）
showPreAlertWindows()   → 预警窗：屏幕下方中央
showToastAlertWindows() → toast 窗
syncAlertSurfaces()     → 根据快照增删窗口（有报警就建，处理完就销毁）
```

### 5.8 更新机制（主进程 updater 部分）

```
检查线路顺序（updateCandidates）：
  1. 内部服务器 LAN   (http://192.168.110.111:8088/updates)
  2. 内部服务器公网   (https://obs.huaweilive.top:8088/updates)
  3. 阿里云镜像       (配置了才用)
  4. gh-proxy.com 加速
  5. ghproxy.net 加速
  6. GitHub Releases
每一路：electron-updater 的 generic provider 检查 latest.yml
找到新版本 → 后台下载（Windows）→ 写 pendingUpdateStore → 退出时静默安装
```

### 5.9 开播检查（preflightCheck.ts + preflightDiscovery.ts）

**它解决什么**：直播前要打开 OBS、直播伴侣、浏览器后台、ATEM 软件、宇宙猫检测工具，还要摆好窗口位置。手工做很烦，一键搞定。

```
check()       → 检查 5 类应用是否在运行（进程识别）
discover()    → 自动找应用路径：
                 标准安装目录 → 注册表 App Paths → 开始菜单/桌面快捷方式
launch()      → 启动缺失的应用（宇宙猫以管理员身份）
captureLayout() → 保存当前窗口位置（归一化坐标）
restoreWindow() → 按保存的位置恢复窗口
openProjector() → 打开 OBS 节目输出投影（窗口化）
```

**进程识别的难点**（直播伴侣等进程名不固定）：

```
1. 配置的路径/快捷方式目标 → 精确匹配
2. 进程别名表（PROCESS_ALIASES）→ 模糊匹配
3. 窗口标题关键词 → 兜底（排除浏览器标签页误判）
4. 安装目录前缀 → 识别子进程
```

---

## 第 6 章 服务器深潜（remote-server）

### 6.1 基础概念：HTTP 服务怎么跑起来的

服务器代码 `server.mjs` 是**纯 Node.js、无框架**。核心只有三件事：

```
1. createHttpServer(requestListener)  → 处理所有 HTTP 请求
2. WebSocketServer({ noServer: true }) → 处理 WebSocket 升级请求
3. 启动时加载 remote-state.json → 程序内维护 data 对象 → 定期写回
```

**请求处理入口**（`requestListener`）：

```
收到请求 → 解析 URL
  ├─ /complaint/*        → 转发给 complaint-tool（客诉代理）
  ├─ /health             → 返回健康状态 JSON
  ├─ /api/*              → handleApi() 分发到具体接口
  ├─ /admin, /admin/, /  → 302 跳转 /monitor
  ├─ /monitor            → 返回 monitor.html
  ├─ /remote, /pair/*    → 返回 mobile.html
  ├─ /assets/*           → 静态文件（带缓存）
  └─ /updates/*          → 更新缓存文件下载
```

### 6.2 数据存储：不用数据库的 JSON 方案

```javascript
// 服务器内存里的数据结构（对应 data/remote-state.json）
data = {
  schemaVersion: 1,
  devices:     [ { uuid, secretHash, roomName, roomNameRevision, lastState, ... } ],
  requests:    [ { id, deviceUuid, clientId, status: 'pending', ... } ],  // 手机申请
  approvals:   [ { id, deviceUuid, clientId, tokenHash, ... } ],          // 已授权
  commands:    [ { id, deviceUuid, command, status, ... } ],              // 管理审计
  notificationSettings: { enabled, audioAlertSeconds, ... }
}
```

**写入安全**（`saveData()`）：
```
JSON.stringify(data) → 写入 data.json.tmp-<pid>-<token> → rename 成 data.json
```
先用临时文件再改名，防止写一半崩溃把数据写坏。权限 0600（只有所有者能读）。

**数据保留策略**（`pruneStoredData()`）：
- 申请 24 小时未处理 → 自动拒绝
- 明文审批 token 24 小时后删除（只留 tokenHash）
- 授权记录保留 30 天（撤销后）
- 命令审计保留 30 天，最多 500 条

### 6.3 WebSocket 消息协议

**桌面端（/ws/desktop）**：

| 方向 | 类型 | 内容 |
|---|---|---|
| 电脑→服务器 | `state` | 状态摘要（400ms 节流） |
| 电脑→服务器 | `meter` | 电平帧（仅手机监看启用时转发） |
| 电脑→服务器 | `latency-ping` | 延迟探测（每 10 秒） |
| 电脑→服务器 | `admin-command-result` | 远程命令执行结果 |
| 服务器→电脑 | `registered` | 注册确认（含 roomName + pairUrl） |
| 服务器→电脑 | `device-config` | 服务器改名同步 |
| 服务器→电脑 | `presence` | 在线手机数 |
| 服务器→电脑 | `latency-pong` | 延迟响应 |
| 服务器→电脑 | `state-ack` | 状态已接收确认 |
| 服务器→电脑 | `admin-command` | 下发远程管理命令 |

**手机端（/ws/mobile）**：
- 手机→服务器：`command`（服务器一律回「仅支持监看」）
- 服务器→手机：`state` / `meter` / `device-status`

### 6.4 API 详细表

| 路由 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/health` | GET | 无 | 健康检查 |
| `/api/updates/status` | GET | 无 | 更新缓存状态 |
| `/api/updates/sync` | POST | Bearer Token | 手动触发同步（CI 预热用） |
| `/api/devices/register` | POST | UUID+secret | 电脑注册/刷新（限频 60/min） |
| `/api/pair/info` | GET | pairToken | 手机查看配对信息 |
| `/api/pair/request` | POST | pairToken | 手机提交访问申请（限频 12/10min） |
| `/api/pair/request/:id` | GET | clientId | 轮询申请状态，批准后返回 accessToken |
| `/api/mobile/session` | GET | accessToken | 建立手机监看会话 |
| `/api/admin/login` | POST | 密码 | 管理员登录（错 6 次锁 5 分钟） |
| `/api/admin/overview` | GET | 会话 | 设备/申请/授权/通知总览 |
| `/api/admin/requests/:id/approve` | POST | 会话 | 批准手机申请 |
| `/api/admin/requests/:id/reject` | POST | 会话 | 拒绝手机申请 |
| `/api/admin/approvals/:id` | DELETE | 会话 | 撤销授权 |
| `/api/admin/updates` | GET | 会话 | 缓存文件列表 |
| `/api/admin/updates/sync` | POST | 会话 | 立即同步 |
| `/api/admin/updates/:file` | PUT/DELETE | 会话 | 手动上传/删除缓存文件 |
| `/api/monitor/overview` | GET | 会话 | 监控总览 |
| `/api/monitor/notification-settings` | GET/PUT | 会话 | 企业微信设置 |
| `/api/monitor/notification-settings/reset` | POST | 会话 | 恢复默认 |
| `/api/monitor/devices/:id/name` | PATCH | 会话 | 修改直播间名称 |
| `/api/monitor/devices/:id/wecom-test` | POST | 会话 | 企业微信测试消息 |
| `/api/monitor/devices/:id/wecom-notifications` | PATCH | 会话 | 开关该直播间通知 |
| `/api/monitor/devices/:id/commands` | POST | 会话 | 下发管理命令 |
| `/ws/desktop` | WS | URL 参数 | 桌面状态通道 |
| `/ws/mobile` | WS | URL 参数 | 手机监看通道 |

### 6.5 远程管理命令（白名单）

```javascript
REMOTE_ADMIN_COMMANDS = [
  'show_app',        // 打开检测助手
  'reconnect_obs',   // 重连 OBS
  'reconnect_atem',  // 重连 ATEM
  'check_update',    // 检查更新
  'pause_monitoring',// 暂停检测（需要二次确认）
  'resume_monitoring'// 恢复检测
]
```

执行流程：
```
管理员点按钮 → POST /api/monitor/devices/:id/commands
  → dispatchAdminCommand() 生成命令记录 → 写入审计 → 通过 WS 下发
  → 电脑执行 → 回执 admin-command-result → 服务器更新记录状态
  → 20 秒无回执 → 标记 timeout
```

### 6.6 企业微信通知（wecom-notifier.mjs）

**通知类型**：只在这 4 种状态变化时发送：
- 音频进入正式报警（`audio_alert`）
- 音频恢复（`audio_recovery`）
- 机位停留超时（`camera_alert`）
- 机位恢复正常（`camera_recovery`）

**去重原理**：每个设备在内存里维护一份状态缓存（`deviceStates`）：

```
上次状态: { audioAlert: false }
本次状态: { audioAlert: true }   ← 变化了！
  → 发送报警通知 → 更新缓存为 { audioAlert: true, audioNotificationSent: true }
下次再来: { audioAlert: true }   ← 没变化
  → 不重复发送
```

**批量合并**：1200ms 窗口内的事件攒一批，合并成一条消息发送，降低群消息刷屏。
**失败重试**：按 1s → 3s → 10s 退避，最多 4 次。
**webhook 校验**：必须是 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`。

### 6.7 更新缓存（update-cache.mjs）

**为什么需要它**：客户端从 GitHub 下载慢/不稳。服务器提前下载好安装包，客户端从内网/公网服务器下载飞快。

```
启动 → 立即同步一次 → 之后每 2 分钟检查
同步流程：
  1. 下载 latest.yml + latest-mac.yml（元数据）
  2. 解析出版本号（必须一致，否则报错）和安装包清单
  3. 逐个下载安装包：
       · 边下边算 SHA-512
       · 大小不符 → 删掉重下
       · SHA-512 不符 → 删掉重下
  4. 所有包就绪 → 才替换元数据文件（防止客户端拿到"指向不存在安装包"的描述）
  5. 删除旧版本安装包（只保留最近 2 版）
  6. 状态写入 .update-cache-status.json
```

**安全细节**：
- `UPDATE_GITHUB_TOKEN` 只加在直连 github.com 的请求头，代理请求不带（防泄露）
- 文件大小上限：元数据 1MB，安装包 1GB
- 用临时文件下载，校验通过才 rename 成正式文件名

### 6.8 前端页面（public/，原生 JS）

**monitor.html + monitor.js（集中监控 = 唯一管理主界面）**：
- 登录 → `/api/monitor/overview` 轮询（3 秒，页面隐藏时 15 秒）
- 直播间一行 → 点击开抽屉看详情
- 抽屉里可：改名、企业微信测试、开关通知、执行管理命令（暂停需二次确认）
- 顶部按钮：「访问审批」「更新管理」「通知设置」
- 命令审计列表在页面底部

**mobile.html + mobile.js（手机监看）**：
- 扫 `/pair/<token>` → 填房间名 → 提交申请
- 轮询申请状态 → 批准后拿 accessToken → 建 WS 连接
- 显示音频电平、机位、OBS 状态
- 画中画功能：用预生成的 mp4 视频模拟电平动画（iOS/Android 系统画中画）

**admin.html + admin.js**：v3.9.6 起废弃，`/admin` 自动跳转 `/monitor`。

---

## 第 7 章 开发环境搭建（从零开始）

### 7.1 安装前置工具

| 工具 | 版本要求 | 安装方式（macOS） |
|---|---|---|
| Node.js | ≥ 22 | `brew install node` 或官网安装包 |
| Git | 任意新版 | `brew install git` |
| Docker（服务端开发） | 任意新版 | Docker Desktop |
| sshpass（部署用） | 任意 | `brew install sshpass`（可能需要第三方 tap：`brew install esolitos/ipa/sshpass`） |

检查是否装好：
```bash
node -v        # 应输出 v22.x 或更高
npm -v         # 应输出 10.x 或更高
git --version  # 应输出 2.x
```

### 7.2 克隆仓库

```bash
git clone https://github.com/Lin518-hub/obs-audio-monitor-assistant.git
cd obs-audio-monitor-assistant
```

### 7.3 安装依赖

```bash
# 根目录（客户端）
npm install

# 服务器目录（独立的包）
cd remote-server
npm install
cd ..
```

> ⚠️ **常见坑**：
> - Electron 二进制下载慢 → 设置镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
> - 如果 npm install 报权限错误 → 用 `npm install` 而非 sudo

### 7.4 运行开发模式（客户端）

```bash
npm run dev
```

这条命令同时做了三件事（用了 `concurrently` 并行）：
1. `vite --host 127.0.0.1` → 启动开发服务器（渲染进程热更新）
2. `tsc -p tsconfig.main.json --watch` → 编译主进程并监听变更
3. `electron .` → 启动 Electron 应用

**开发时改动代码**：改渲染进程界面 → 浏览器热更新立即生效；改主进程 → 需要重启 Electron（tsc watch 会自动重新编译，但 Electron 不会自动重启）。

### 7.5 调试技巧

- **主进程日志**：终端直接能看到 `console.log` 输出。
- **渲染进程日志**：Electron 窗口按 `Cmd+Option+I`（macOS）/ `Ctrl+Shift+I`（Windows）打开 DevTools。
- **崩溃排查**：主进程 `render-process-gone` 事件会打印原因。
- **断点调试**：`.vscode/launch.json` 可配 Electron 主进程调试（参考 Electron 官方文档）。

### 7.6 常见开发错误速查

| 错误 | 原因 | 解决 |
|---|---|---|
| `Cannot find module 'electron'` | 依赖没装全 | `npm install` |
| 端口 5173 被占用 | 上次 dev 没退干净 | 杀进程或改 vite.config.ts 端口 |
| `Error: EADDRINUSE` | 同上 | 检查 5173/4455 占用 |
| TS 类型报错 | 类型不匹配 | 看错误提示，不要用 `as any` 跳过 |
| OBS 连不上 | OBS 没开/端口错/密码错 | 设置里测试连接 |

---

## 第 8 章 测试

### 8.1 怎么跑

```bash
# 客户端（119 项）
npm test

# 服务端（25 项）
cd remote-server && npm test
```

### 8.2 测试文件对应关系

| 文件 | 测什么 | 典型用例 |
|---|---|---|
| `test/silenceState.test.ts` | 状态机 | 120 秒报警、75% 预警、确定/忽略、开播前不计数 |
| `test/obsMonitor.test.ts` | OBS 监测 | 测试报警、模拟开播、虚拟摄像头、说话确认 |
| `test/atemMonitor.test.ts` | ATEM | 10/12 分钟阈值、豁免机位、切换记录、扫描 |
| `test/configStore.test.ts` | 配置 | 数值清洗、密码加密、版本迁移 |
| `test/remoteBridge.test.ts` | 远程桥 | 线路选择、房间名冲突、代理、遥测裁剪 |
| `test/audio.test.ts` | 音频算法 | dB 换算、平滑、峰值选择 |
| `test/preflight*.test.ts` | 开播检查 | 进程解析、快捷方式识别 |
| `test/reminderTiming.test.ts` | 计时 | 进度/颜色分段 |
| `test/atemHistoryStore/atemSessionStore.test.ts` | 存储 | 持久化、上限 |
| `test/pendingUpdateStore.test.ts` | 更新登记 | 持久化、清理 |
| `test/latestTaskQueue.test.ts` | 并发队列 | 只跑最新任务 |
| `test/windowPlacement.test.ts` | 窗口位置 | 归一化、跨屏恢复 |
| `remote-server/test/server.test.mjs` | 服务端 | 注册/审批/撤销、管理命令、/admin 跳转、complaint 保留 |
| `remote-server/test/update-cache.test.mjs` | 更新缓存 | SHA-512 失败不发布、双版本保留 |
| `remote-server/test/wecom-notifier.test.mjs` | 企业微信 | webhook 校验、去重、批量 |

### 8.3 测试技巧（怎么给测试打桩）

**客户端 mock Electron**：
```typescript
// test/configStore.test.ts 的写法
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => tempDir },
  safeStorage: { encryptStringAsync: ..., decryptStringAsync: ... }
}));
```

**mock 网络库**：
```typescript
// test/atemMonitor.test.ts 的写法
vi.mock('atem-connection', () => ({ Atem: MockAtem, AtemConnectionStatus: {...} }));
```

**访问私有方法**（测试用 `as unknown as` 强制类型转换）：
```typescript
const internals = monitor as unknown as { state: { connected: boolean } };
internals.state.connected = true;
```

> ⚠️ 这是测试代码里**唯一允许**的 `as` 用法——生产代码禁止。

### 8.4 新增功能的测试要求

**发版硬性标准**：客户端 137 + 服务端 29 全绿。新增功能必须补测试：
- 改 `silenceState.ts` → 补 `silenceState.test.ts`
- 改服务器 API → 补 `server.test.mjs`
- 涉及配置 → 补 `configStore.test.ts`

---

## 第 9 章 构建与打包

### 9.1 版本号唯一来源

`package.json` 的 `version` 字段（当前 `3.9.7`）。Vite 通过 `define` 把它注入为 `__APP_VERSION__` 全局变量，渲染进程的 `appVersion.ts` 读取它。发布桌面端时同步修改 `remote-server/package.json`，确保监控中心与服务端记录版本一致。

### 9.2 完整构建

```bash
npm run build     # = clean + typecheck + vite build + tsc main
npm run dist:win  # Windows 安装包（在 Windows 或 CI 上跑）
npm run dist:mac  # macOS zip（arm64）
```

### 9.3 产物说明

```
release/
├── OBS-Audio-Monitor-Assistant-Setup-3.9.7-x64.exe   # Windows 安装包
├── OBS-Audio-Monitor-Assistant-Setup-3.9.7-x64.exe.blockmap  # 增量更新用
├── latest.yml                                          # 更新描述（Windows）
├── OBS-Audio-Monitor-Assistant-3.9.7-arm64.zip        # macOS 应用包
├── OBS-Audio-Monitor-Assistant-3.9.7-arm64.zip.blockmap
└── latest-mac.yml                                     # 更新描述（macOS）
```

**关键**：`latest.yml` 里包含每个安装包的 `sha512` 和 `size`——服务器缓存和客户端更新都靠它校验完整性。

### 9.4 electron-builder 配置要点（package.json 的 build 段）

```json
{
  "appId": "com.obsaudioassistant.app",
  "productName": "OBS 音频检测助手",
  "publish": [{ "provider": "github", "owner": "Lin518-hub", "repo": "obs-audio-monitor-assistant" }],
  "win": { "target": ["nsis"], "icon": "build/icon.ico" },
  "mac": { "target": ["zip"], "icon": "build/icon.icns" }
}
```

---

## 第 10 章 发布流程（GitHub Actions）

### 10.1 发布触发方式

- 推送到 `main` 分支 → 自动触发全部构建
- 手动触发：GitHub → Actions → Desktop Build → Run workflow

### 10.2 工作流结构（.github/workflows/windows-build.yml）

```
main 分支推送
  │
  ├─ job: remote-server-tests  (Ubuntu)
  │    npm --prefix remote-server test   # 服务端 25 项
  │
  ├─ job: windows  (Windows)
  │    npm test        # 客户端测试
  │    npm run dist:win
  │
  ├─ job: mac  (macOS)
  │    npm test
  │    npm run dist:mac
  │
  └─ job: release  (Ubuntu，等上面三个都成功，仅 main 分支)
       ├─ 下载三个产物
       ├─ 删除旧 latest release
       └─ gh release create latest <全部文件> --latest
            │
            └─ job: warm-internal-update-cache
                 POST 到服务器 /api/updates/sync（带 UPDATE_SYNC_TOKEN）
                 → 服务器立即去 GitHub 预下载新包
```

### 10.3 发版完整流程（手动）

```
1. 本地：改 package.json version → 3.9.7
2. 本地：更新 README 版本说明
3. 本地：npm test（客户端）+ cd remote-server && npm test
4. 提交 + 推送 main：git commit -m "Release v3.9.7 ..." && git push
5. CI 自动跑：测试 → 构建 → 发 latest release → 预热服务器缓存
6. 检查：GitHub Releases 页有最新安装包
7. 服务器检查：curl /health 看 updates.version == 3.9.7
8. 客户端检查更新 → 应从内部服务器秒下
```

### 10.4 CI 相关 Secrets（GitHub 仓库设置里配）

| Secret | 用途 |
|---|---|
| `INTERNAL_UPDATE_SYNC_URL` | 服务器更新同步地址（含端口） |
| `INTERNAL_UPDATE_SYNC_TOKEN` | 对应服务器 `.env` 的 `UPDATE_SYNC_TOKEN` |

---

## 第 11 章 服务器部署全流程

> 这是最重要的章节之一——跟着做就能完成一次完整部署。以 2026-08-04 的 `/monitor` 改造部署为实例。

### 11.1 服务器信息

| 项目 | 值 |
|---|---|
| 主机 IP | `192.168.110.111`（内网） |
| 公网域名 | `obs.huaweilive.top` → `39.170.18.179` |
| SSH 用户 | `liveserver` |
| SSH 认证 | 密码认证（公钥未配置） |
| 部署目录 | `/home/liveserver/obs-audio-remote/` |
| 服务容器 | `obs-audio-remote`（本项目的服务） |
| 其他容器 | `complaint-tool`（客诉，勿动）、`access-*`（门禁，勿动） |
| 系统 | Ubuntu 26.04 LTS，Docker 29.3.1，Compose v5.2.0 |

### 11.2 基础概念：SSH 和 sshpass

**SSH** 是安全登录远程电脑的协议。命令格式：

```bash
ssh 用户名@主机IP
# 会提示输入密码
```

**sshpass** 让密码可以直接作为参数传入（脚本自动化用）：

```bash
sshpass -p '密码' ssh liveserver@192.168.110.111 '要在服务器上执行的命令'
```

> ⚠️ **血泪坑（实测）**：不要在 sshpass 命令前面加 `export CI=true ...` 这种环境变量前缀——会导致密码认证莫名失败（`Permission denied`）。如果确实需要环境变量，写在别处或用 `env` 包裹。

**scp** 是 SSH 之上的文件复制工具：

```bash
# 本地文件 → 服务器
sshpass -p '密码' scp 本地文件 liveserver@192.168.110.111:服务器目标路径
```

### 11.3 完整部署步骤（改造后同步代码的标准流程）

**第 1 步：本地确认代码状态**

```bash
cd /path/to/OBS音频检测/remote-server
git status                 # 确认在最新代码
npm test                   # 服务端 25 项测试必须全绿
```

**第 2 步：对比本地与服务器的文件差异**

原理：服务器目录不是 git 仓库，无法 `git pull`，只能手动上传。先算出两边文件的 md5（文件指纹），不一样的就是要上传的。

```bash
# 服务器端所有相关文件的 md5
sshpass -p '密码' ssh liveserver@192.168.110.111 \
  'cd ~/obs-audio-remote && md5sum src/*.mjs public/*.html public/assets/*.js public/assets/*.css'

# 本地同样文件的 md5（macOS 用 md5 -r，Linux 用 md5sum）
md5 -r src/*.mjs public/*.html public/assets/*.js public/assets/*.css
```

对比结果：md5 相同 = 无需上传；不同 = 需要上传。

> 🔒 **黄金法则**：只上传代码文件。**绝不动**这些目录：`.env`（密钥配置）、`data/`（数据）、`updates/`（缓存）、`tls/`（证书）、`backups/`（备份）。

**第 3 步：在服务器上备份将被覆盖的文件**

```bash
sshpass -p '密码' ssh liveserver@192.168.110.111 '
cd ~/obs-audio-remote &&
mkdir -p backups/$(date +%Y%m%d-%H%M%S)-描述 &&
cp -p src/server.mjs backups/20260804-monitor-center/ &&
cp -p public/monitor.html public/assets/monitor.js public/assets/app.css backups/20260804-monitor-center/ &&
ls backups/20260804-monitor-center/'
```

> 为什么要备份：一旦新代码有问题，可以直接用备份回滚。`backups/` 目录里已经有很多历史备份（如 `server-before-complaint-proxy-20260730.mjs`）。

**第 4 步：上传变更文件**

```bash
cd /path/to/OBS音频检测/remote-server

sshpass -p '密码' scp src/server.mjs \
  liveserver@192.168.110.111:~/obs-audio-remote/src/server.mjs

sshpass -p '密码' scp public/monitor.html \
  liveserver@192.168.110.111:~/obs-audio-remote/public/monitor.html

# ... 其他变更文件同理
```

**第 5 步：上传后二次校验**

```bash
sshpass -p '密码' ssh liveserver@192.168.110.111 \
  'cd ~/obs-audio-remote && md5sum src/server.mjs public/monitor.html public/assets/monitor.js public/assets/app.css'
```

和本地 md5 逐一比对，**完全一致才继续**。

**第 6 步：重建容器**

```bash
sshpass -p '密码' ssh liveserver@192.168.110.111 \
  'cd ~/obs-audio-remote && docker compose up -d --build'
```

`docker compose up -d --build` 的意思是：`--build` 重新构建镜像（把新代码打进镜像），`-d` 后台运行，`up` 启动/更新容器。输出末尾应看到 `Container obs-audio-remote Started`。

**第 7 步：验证（见 11.4）**

### 11.4 部署后验证清单

```bash
sshpass -p '密码' ssh liveserver@192.168.110.111 '
cd ~/obs-audio-remote

# 1. 容器状态（应为 Up (healthy)）
docker compose ps

# 2. 健康检查
curl -sS http://192.168.110.111:8088/health | python3 -m json.tool

# 3. 路由跳转验证（如果是路由改造）
for p in / /admin /admin/; do
  printf "%s -> " "$p"
  curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" http://192.168.110.111:8088$p
done

# 4. 主页面 200
curl -sS -o /dev/null -w "monitor: %{http_code}\n" http://192.168.110.111:8088/monitor

# 5. HTTPS 完整链路（用 --resolve 让域名解析到内网 IP，绕过公网）
curl -sS --resolve obs.huaweilive.top:8088:192.168.110.111 \
  -o /dev/null -w "https: %{http_code}\n" https://obs.huaweilive.top:8088/health

# 6. 客诉代理保留
curl -sS -o /dev/null -w "complaint: %{http_code}\n" http://192.168.110.111:8088/complaint/api/server-info'
```

**预期结果**：
- 容器 `Up (healthy)`
- `/health` → `{"ok": true, "desktops": N}`（N ≥ 1 说明有电脑在线）
- `/`、`/admin`、`/admin/` → 全部 302 跳转 `/monitor`
- `/monitor` → 200
- HTTPS → 200（证书有效）
- complaint → 200

### 11.5 回滚流程

```bash
sshpass -p '密码' ssh liveserver@192.168.110.111 '
cd ~/obs-audio-remote
cp -p backups/<备份目录>/server.mjs src/server.mjs
cp -p backups/<备份目录>/monitor.html public/monitor.html
cp -p backups/<备份目录>/monitor.js public/assets/monitor.js
cp -p backups/<备份目录>/app.css public/assets/app.css
docker compose up -d --build'
```

回滚后用 11.4 的验证清单重新验证。

### 11.6 服务器 .env 配置说明

服务器 `.env` 文件（已存在，gitignore 排除，**不要提交到 git**）：

```dotenv
PORT=8088
PUBLIC_BASE_URL=https://obs.huaweilive.top:8088    # 二维码/桌面端使用的地址
ADMIN_PASSWORD=xxxxxxxx                             # 管理员密码（≥12字符）
DATA_DIR=/data                                      # 容器内数据目录（对应宿主机 ./data）
UPDATE_DIR=/updates                                 # 容器内更新目录（对应宿主机 ./updates）
UPDATE_SYNC_ENABLED=true
UPDATE_SYNC_INTERVAL_MS=120000                      # 更新缓存轮询周期 2 分钟
UPDATE_RELEASE_BASE_URLS=                           # 留空 = GitHub→ghproxy.net→gh-proxy.com
UPDATE_GITHUB_TOKEN=                                # 私有仓库只读 Token（可选）
UPDATE_SYNC_TOKEN=                                  # CI 预热凭据（可选）
WECOM_NOTIFY_ENABLED=true
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...  # 企业微信群机器人
TLS_CERT_FILE=/run/tls/fullchain.pem                # HTTPS 证书
TLS_KEY_FILE=/run/tls/privkey.pem                   # HTTPS 私钥
COMPLAINT_PROXY_URL=http://complaint-tool:8010      # 客诉代理上游（勿删）
```

---

## 第 12 章 服务器运维

### 12.1 常用命令

```bash
# 查看日志（-f 跟随输出）
docker logs --tail 100 obs-audio-remote
docker logs -f obs-audio-remote

# 健康检查
curl -sS http://192.168.110.111:8088/health

# 重启
docker compose restart obs-audio-remote

# 重建（改代码后）
cd ~/obs-audio-remote && docker compose up -d --build

# 手动触发更新缓存同步
curl -sS -X POST -H "Authorization: Bearer $UPDATE_SYNC_TOKEN" \
  http://192.168.110.111:8088/api/updates/sync
```

### 12.2 数据备份（重要！）

```bash
# 备份状态数据（设备/审批/审计）
cp ~/obs-audio-remote/data/remote-state.json ~/obs-audio-remote/backups/state-$(date +%Y%m%d).json

# 查看备份历史
ls -la ~/obs-audio-remote/backups/
```

`remote-state.json` 包含所有直播间的设备、手机授权、管理审计——**丢了就无法恢复**。建议定期备份。

### 12.3 证书续期

- 服务器 HTTPS 用 Let's Encrypt 证书，存在 `tls/fullchain.pem` + `privkey.pem`。
- 当前证书：2026-07-13 至 2026-10-11（约 90 天有效期）。
- 服务会检测 `tls/` 证书文件变化并热加载，更换证书后无需重启容器。
- **宿主机仍需配置 Certbot 的续签方式**。如果当前证书是手动 DNS 验证签发，必须先配置对应 DNS API 插件或可自动完成的 ACME 验证；否则 `certbot renew` 仍会等待人工验证。

> ⚠️ 建议：用 Certbot 的 deploy hook 将续签后的 `fullchain.pem` 和 `privkey.pem` 原子替换到 `~/obs-audio-remote/tls/`，由服务自动热加载。

### 12.4 磁盘空间

`updates/` 目录会存安装包（每个 120~150MB，保留 2 版 ≈ 500MB+）。定期检查：

```bash
df -h
du -sh ~/obs-audio-remote/updates ~/obs-audio-remote/data
```

### 12.5 服务器上的其他容器（重要约束）

```
obs-audio-remote    ← 本项目的服务，可以动
complaint-tool      ← 客诉系统，别动（OBS 只是它的反向代理）
access-*            ← 门禁系统（caddy/postgres/redis），绝对别动
```

`COMPLAINT_PROXY.md` 明确警告：删除 `/complaint` 路由会导致客诉客户端、二维码复制页、更新下载全部 404。**改 server.mjs 时保留 `proxyComplaint()` 相关代码**。

---

## 第 13 章 网络与公网访问

### 13.1 基础概念：NAT 与端口映射

- 服务器在局域网内（`192.168.110.111`），公网访问不了这个内网地址。
- 路由器（`192.168.110.1`）做 **端口映射（DNAT）**：把「公网 IP 的某个端口」转发到「内网某台机器的某个端口」。
- 本项目假设路由器已配置：`39.170.18.179:8088 → 192.168.110.111:8088`。

### 13.2 内网无法回环（hairpin NAT）

**现象**：在服务器上 `curl http://39.170.18.179:8088/health` 超时。

**原因**：大多数路由器不支持「从内网访问自己的公网 IP」（NAT hairpin/loopback）。服务器流量出去又回来时，路由器不知道往哪转发。

**结论**：这是**正常现象**，不代表公网故障。验证公网必须从**其他设备**（手机流量、外网电脑）访问。

### 13.3 访问路径一览

| 场景 | 地址 |
|---|---|
| 直播网内（电脑上报） | `http://192.168.110.111:8088` |
| 外网（电脑回退线路） | `https://obs.huaweilive.top:8088` |
| 集中监控（管理员） | `http://192.168.110.111:8088/monitor` |
| 手机扫码 | `<服务地址>/pair/<token>` |
| 健康检查 | `http://192.168.110.111:8088/health` |

### 13.4 域名解析

```
obs.huaweilive.top → 39.170.18.179（DNS A 记录）
```

服务器出口公网 IP 也是 `39.170.18.179`（用 `curl ifconfig.me` 确认），两者一致。

### 13.5 若公网打不开的排查顺序

```
1. 先确认服务器本身服务正常：内网 curl /health 返回 ok
2. 从手机（用流量）访问 https://obs.huaweilive.top:8088/health
3. 若手机也打不开 → 查路由器端口映射（192.168.110.1 管理页）
   · 有没有 8088 的 DNAT 规则？
   · 运营商防火墙放行 8088 了吗？（有些运营商封非标端口）
4. 若手机能打开 → 服务器/内网没问题，之前测试方法不对（见 13.2）
```

---

## 第 14 章 常见问题排查

### 14.1 客户端

| 现象 | 可能原因 | 排查/解决 |
|---|---|---|
| "OBS 未连接" | OBS 没开 / WebSocket 没启用 / 端口或密码错 | 设置→连接与设备→测试连接 |
| 监控中心显示"等待音频数据" | 电脑与服务器时钟偏差；音源未选；没开播 | 已选音源；OBS 开播；重启客户端 |
| 一直不报警 | 没开播/录制（未进入检测）；阈值太高；音源没选 | 看顶部状态横幅提示 |
| 更新一直转圈 | 内部服务器缓存未就绪；网络不通 | /monitor 看更新缓存状态；客户端会自动回退其他源 |
| macOS 提示"文件已损坏" | Gatekeeper 隔离标记（未签名） | `sudo xattr -cr /Applications/OBS\ 音频检测助手.app` |
| 小浮窗不见了 | 被误关；布局版本迁移 | 托盘菜单重新打开 |
| 报警没声音 | alertSoundEnabled 关闭；系统默认输出设备静音 | 设置里开启声音提示 |

### 14.2 服务端

| 现象 | 可能原因 | 排查/解决 |
|---|---|---|
| 容器 unhealthy | 启动失败 | `docker logs obs-audio-remote` 看错误 |
| 公网打不开 | 路由器 DNAT 缺失 / 运营商封端口 | 见第 13.5 节 |
| 企业微信不推送 | webhook 错 / 通知关闭 / 该直播间被单独关闭 | /monitor 顶部看通知状态；「通知设置」里查看 |
| 更新缓存一直 error | GitHub 网络问题 / Token 失效 | /monitor→更新管理→立即同步；看 error 文案 |
| 访问 `/admin` 返回跳转 | ✅ 正常（v3.9.6 起统一到 /monitor） | 无需处理 |
| 手机扫码进不去 | 未审批 / 审批过期 / 电脑关了手机监看 | /monitor→访问审批 查看 |
| `/complaint` 502 | complaint-tool 容器挂了 | `docker logs complaint-tool`；不要改 OBS 代码 |

### 14.3 数据异常

| 现象 | 处理 |
|---|---|
| 直播间重复/串名 | 服务器 `/api/monitor/devices/:id/name` 改名；同名设备会自动挤掉旧设备 |
| 需要清理设备 | 直接改 `data/remote-state.json`（需停止容器或改后重启） |
| 想清空所有数据 | 备份后删除 `data/remote-state.json`，重启容器 |

---

## 第 15 章 安全注意事项

1. **凭据纪律**：管理员密码、SSH 密码、GitHub Token、企业微信 Webhook **严禁**写入源码、日志或提交 GitHub。`.env` 已被 gitignore。
2. **哈希存储**：服务器只存 secret 的 SHA-256、审批 token 的 SHA-256；明文 token 24 小时后删除。
3. **最小权限**：容器 `cap_drop: ALL`、只读根文件系统、`no-new-privileges`、非 root 用户。
4. **管理命令白名单**：远程命令固定白名单，危险操作（暂停检测）需二次确认，全部写入审计。
5. **敏感数据不下发**：OBS 密码、完整配置、GitHub Token、Webhook 绝不通过监控接口下发。
6. **网络暴露面**：8088 只绑定内网 IP；公网暴露依赖路由器映射，尽量限定来源。
7. **渲染进程安全**：所有窗口 `contextIsolation + sandbox`；IPC 走 preload 白名单；`setWindowOpenHandler` 拦截弹窗；禁止导航到外部 URL。
8. **开发者模式密码**：硬编码 SHA-256 在 `SettingsPanel.tsx`，作用是防误触（要连点 10 次版本号才出现输入框），**不是真正的安全边界**。
9. **备份**：定期备份 `data/`；部署前备份被覆盖文件。
10. **密码强度**：`ADMIN_PASSWORD` 至少 12 字符，独立强密码，不与其他系统共用。

---

## 第 16 章 术语表

| 术语 | 解释 |
|---|---|
| **AppSnapshot** | 客户端主进程发给渲染进程的完整状态对象（`types.ts` 定义） |
| **IPC** | 进程间通信；Electron 主进程与渲染进程对话的通道 |
| **Preload** | 渲染进程加载前运行的桥接脚本，暴露白名单 API（`preload.cts`） |
| **AppConfig** | 全部用户配置的集合（`types.ts`） |
| **快照（Snapshot）** | 某一时刻的完整状态，客户端每秒广播一次 |
| **电平（Level）** | 声音信号的强度，OBS 以 0~1 乘数上报，本项目转成 dB |
| **dB** | 分贝，对数单位；-100 = 无声，0 = 满量程 |
| **静音阈值** | 低于这个 dB 值视为静音（默认 -55dB） |
| **迟滞（Hysteresis）** | 阈值上下 1.5dB 的缓冲带，防止电平在阈值边缘抖动造成反复触发 |
| **预警（Pre-Alert）** | 静音达到报警时长 75% 时的黄牌提示 |
| **PGM** | Program，ATEM 正在播出的信号 |
| **PVW** | Preview，ATEM 准备切换的预览信号 |
| **ATEM** | Blackmagic 生产的视频切换台（导播台） |
| **机位停留** | PGM 一直不切换，同一机位持续播出 |
| **出镜机位** | 主播/嘉宾长期占用的机位，豁免计时 |
| **RemoteBridge** | 客户端里负责与远程服务器通信的类 |
| **远端摘要** | 客户端上报时裁剪后的精简状态（不含密码等敏感数据） |
| **revision（修订号）** | 直播间名称的版本号，解决多人改名冲突 |
| **WebSocket** | 全双工长连接协议，服务端可主动推送 |
| **Docker 容器** | 打包了程序+运行环境的隔离进程 |
| **docker-compose** | 用 YAML 描述多容器编排的工具 |
| **DNAT / 端口映射** | 路由器把公网端口转发到内网机器的规则 |
| **hairpin NAT** | 内网访问自己公网 IP 的能力（本路由器不支持） |
| **SHA-512** | 加密哈希，用于校验文件完整 |
| **latest.yml** | electron-updater 的更新描述文件（含版本/文件/校验值） |
| **electron-updater** | 客户端自动更新库 |
| **白名单命令** | 服务器允许下发的固定命令集合 |

---

## 第 17 章 给新人的学习路线

如果你是刚入门的程序员，建议按这个顺序学习这个项目：

### 阶段 1：跑起来（1 天）
1. 读第 2 章，理解 Electron 主/渲染进程
2. 按第 7 章搭好环境
3. `npm run dev` 启动，点一点界面

### 阶段 2：理解核心数据流（2~3 天）
1. 读第 3 章数据流
2. 读 `src/shared/types.ts` 的 `AppSnapshot` 和 `AppConfig`（全部字段）
3. 读 `src/shared/silenceState.ts` 全文（状态机，只有 250 行）
4. 跑 `npx vitest run test/silenceState.test.ts` 看它怎么测

### 阶段 3：追一条完整链路（2~3 天）
选「静音 120 秒报警」这条链路，从 `obsMonitor.ts` 的 `onInputVolumeMeters` 追到 `main.ts` 的 `showAlertWindows` 再到 `AlertApp.tsx`，每行都看懂。

### 阶段 4：改一个小功能（1 周）
例如：修改预警比例默认值、增加一条状态文字。改完补测试，跑全量测试。

### 阶段 5：部署一次（1 天）
按第 11 章完整部署一次（哪怕在测试环境），理解 `docker compose up -d --build` 到底做了什么。

### 推荐学习资源（中文）
- Electron 官方文档（electronjs.org）
- React 官方文档（react.dev）
- TypeScript 官方文档（typescriptlang.org）
- 《Node.js 实战》

---

## 附录 A 命令速查表

### 本地开发
```bash
npm install                # 装依赖
npm run dev                # 开发模式（热更新）
npm test                   # 客户端测试 119 项
npm run typecheck          # 类型检查
npm run build              # 完整构建
npm run dist:win           # Windows 安装包
npm run dist:mac           # macOS 包
```

### 服务端
```bash
cd remote-server
npm install                # 装依赖（ws + yaml）
npm test                   # 服务端测试 25 项
npm start                  # 本地直接运行
```

### 部署（服务器）
```bash
# SSH 登录
sshpass -p '密码' ssh liveserver@192.168.110.111

# 对比文件
sshpass -p '密码' ssh liveserver@192.168.110.111 'cd ~/obs-audio-remote && md5sum src/*.mjs public/*.html public/assets/*.js public/assets/*.css'
md5 -r src/*.mjs public/*.html public/assets/*.js public/assets/*.css   # 本地

# 上传
sshpass -p '密码' scp 本地文件 liveserver@192.168.110.111:~/obs-audio-remote/目标路径

# 重建
sshpass -p '密码' ssh liveserver@192.168.110.111 'cd ~/obs-audio-remote && docker compose up -d --build'

# 验证
sshpass -p '密码' ssh liveserver@192.168.110.111 'curl -sS http://192.168.110.111:8088/health'

# 日志
sshpass -p '密码' ssh liveserver@192.168.110.111 'docker logs --tail 100 obs-audio-remote'
```

---

## 附录 B 本次部署记录（2026-08-12，v3.9.7）

- **可靠性**：客户端主进程日志轮转落盘，错误摘要脱敏并上报监控中心；主进程异常采用有限次数重启保护。
- **性能**：浮窗、报警窗与预警窗不再接收完整音量历史；远程桥接采用退避重连；报警音复用 AudioContext。
- **服务端**：监控概览增加短缓存，状态数据每日自动备份并保留 14 份；证书文件变化可热加载；移除直播间重复设备时会清理企业微信通知状态。
- **报警语义**：运行时已移除“单次忽略/延后检测”状态；报警只提供确认或暂停检测。旧历史记录仍兼容读取。
- **验证**：客户端 137 + 服务端 29 测试全绿，生产构建通过；保留 `/complaint` 代理并通过回归测试。
- **部署步骤**：备份原文件至服务器 `backups/20260812-095925-v3.9.7/` → scp 上传 `server.mjs`、`state-backup.mjs`、`tls-certificate.mjs`、`ttl-cache.mjs`、`mobile.html`、`monitor.js`、`mobile.js`、`package.json`、`package-lock.json`、`.env.example` → 服务器 sha256 与本地逐项一致 → `docker compose up -d --build obs-audio-remote`。
- **缓存唤醒**：发布后手动触发内部更新缓存同步时，服务器回环访问公网域名会超时（hairpin NAT 限制），需用 `curl --resolve obs.huaweilive.top:8088:192.168.110.111` 指定内网地址调用 `/api/updates/sync`；当前缓存已就绪 v3.9.7。
- **公网回归**：`/health`（ok，4 台电脑在线）、`/monitor`、`/complaint/api/server-info`、`/complaint/updates/latest.yml`、`/updates/latest.yml` 全部 200。

## 附录 C 历史部署记录（2026-08-04）

- **改造内容**：`/monitor` 成为唯一管理主界面；`/admin`、`/admin/`、`/` 自动 302 跳转 `/monitor`；手机申请审批、授权撤销完整恢复；更新缓存管理合并入监控中心。
- **代码变更**：`git show 6cbce6c` 查看详细 diff：
  - `src/server.mjs`：路由跳转 + `monitorOverview()` 增加 `access` 字段
  - `public/monitor.html` / `public/assets/monitor.js`：新增访问审批、更新管理面板
  - `public/assets/app.css`：新增样式
  - `test/server.test.mjs`：新增 `/admin` 跳转 + 审批/撤销全链路测试
- **客户端**：未改动，未构建桌面安装包（版本仍 3.9.6）。
- **部署步骤**：备份至 `backups/20260804-monitor-center/` → scp 上传 4 个文件 → md5 校验一致 → `docker compose up -d --build`。
- **验证结果**：`/health` ok + 4 台电脑在线；`/`、`/admin`、`/admin/` 全部 302 → `/monitor`；`/monitor` 200 含新面板；客户端 119 + 服务端 25 测试全绿。
- **公网说明**：内网 hairpin 限制导致服务器自连公网地址超时，属正常现象；外网设备可正常访问 `https://obs.huaweilive.top:8088`。
- **文档同步**：`docs/远程访问服务部署.md` 已更新 `/admin` 描述；本 HANDOFF 同步创建。
