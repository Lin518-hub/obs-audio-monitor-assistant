# OBS 音频检测助手 — ATEM 导播台集成开发文档

## 1. 项目背景

**OBS 音频检测助手** 是一款 Electron + React + Vite 桌面应用，核心功能是通过 `obs-websocket-js` 连接 OBS，实时监测指定音频源的静音状态，并在超时后弹窗报警。主要服务于直播带货、电商直播等场景的音频运维。

| 项目信息 | 详情 |
|----------|------|
| 仓库 | `Lin518-hub/obs-audio-monitor-assistant` |
| 技术栈 | Electron 36 + React 19 + Vite 6 + TypeScript 5 |
| 当前版本 | v1.4.0 |
| 核心依赖 | `obs-websocket-js` v5、`electron-updater`、`lucide-react` |
| 新增依赖 | `atem-connection` (Bitfocus 生态) |

---

## 2. 需求描述（ATEM 导播台集成）

### 2.1 背景

直播操作员在现场除了关注音频状态外，还需要知道 **当前播出画面是哪台摄像机（几号机）**。Blackmagic ATEM 切换台是常用的硬件导播台，通过网络暴露设备状态。操作员希望在同一款应用内就能看到当前 PGM（播出）机位号。

### 2.2 核心需求

| 编号 | 需求 | 优先级 |
|------|------|--------|
| R1 | 通过网络直连 ATEM 切换台，无需安装任何额外软件 | P0 |
| R2 | 实时显示当前 PGM（播出）和 PVW（预览）机位号 | P0 |
| R3 | 显示每个输入通道的自定义名称（如 `CAM1`, `主机位`） | P1 |
| R4 | 用数字键盘软切镜头：Num1-9 选 Preview → Enter 执行 AUTO | P1 |
| R5 | 快捷键全局/非全局可选（全局时在其他应用也能用） | P1 |
| R6 | 连接状态实时反馈：未连接 / 连接中 / 已连接 / 失败 | P1 |
| R7 | 一键检测连接按钮，显示设备型号和输入路数 | P1 |
| R8 | 功能目前为 Beta 阶段，默认隐藏，通过开发者模式解锁 | P0 |

### 2.3 非本期需求

- 转场效果选择（默认 MIX）
- Keyer、宏、媒体池控制
- 多 ME（Mix Effect）支持
- DVEs 和 SuperSource 控制
- Tally 灯指示

---

## 3. 技术方案

### 3.1 为什么直接连接 ATEM 硬件而不是 ATEM Software Control？

ATEM Software Control 是 Blackmagic 的官方控制软件，但不提供外部 API。ATEM 硬件本身通过网络暴露了一套 **UDP 协议**，`atem-connection` npm 包（Bitfocus Companion 项目的一部分）完整实现了该协议，可直接与硬件通信，读取和发送切换指令。

### 3.2 架构设计

完全复用现有 OBS 连接的架构模式：

```
ATEM 硬件 ── UDP ── ATEMMonitor (main process) ── IPC ── React UI
                                │
                        globalShortcut (Num1-9)
```

| 层级 | 文件 | 职责 |
|------|------|------|
| 硬件通信 | `src/main/ATEMMonitor.ts` | 封装 `atem-connection` 的 `Atem` 类 |
| 快照注入 | `src/main/main.ts` → `injectATEMState()` | 将 ATEM 状态合并到 `AppSnapshot` |
| IPC 桥接 | `src/main/preload.cts` | 暴露 ATEM API 到渲染进程 |
| 类型声明 | `src/renderer/ipc.ts` | `ObsGuardApi` 接口扩展 |
| 设置面板 | `src/renderer/components/settings/SettingsSections.tsx` | `ATEMSection` 组件 |
| 设置导航 | `src/renderer/components/SettingsPanel.tsx` | 注册 ATEM 导航项 |
| 仪表盘 | `src/renderer/main.tsx` | PGM/PVW 机位显示、键盘事件 |
| 全局快捷键 | `src/main/main.ts` → `registerATEMHotkeys()` | `globalShortcut` 注册 Num1-9 |
| 类型定义 | `src/shared/types.ts` | `ATEMStateSnapshot`、`ATEMTestResult` |

### 3.3 数据流

```
1. 用户输入 IP + 启用 → config:save IPC → atemMonitor.setConfig(enabled, host)
2. setConfig 调用 connect() → Atem.connect(host)
3. ATEM 推送 stateChanged → updateStateFromATEM() → emit('stateChanged')
4. main.ts 监听 stateChanged → injectATEMState(snapshot) → broadcastSnapshot()
5. React 渲染进程收到 snapshot → UI 更新
```

### 3.4 配置项（AppConfig 扩展）

```typescript
atemEnabled: boolean;       // 默认 false
atemHost: string;           // 默认 '192.168.1.240'
atemHotkeyGlobal: boolean;  // 默认 false
```

### 3.5 状态快照（AppSnapshot 扩展）

```typescript
atemConnected: boolean;
atemConnectionState: string; // 'disconnected' | 'connecting' | 'connected' | 'error'
atemProgramInput: number;
atemPreviewInput: number;
atemInputLabels: Record<number, string>;
atemInputCount: number;
```

---

## 4. 已实现的文件清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `atem-connection` |
| `src/shared/types.ts` | 修改 | 新增 `ATEMStateSnapshot`、`ATEMTestResult`；扩展 `AppConfig`(+3)、`AppSnapshot`(+6) |
| `src/main/ATEMMonitor.ts` | **新建** | 核心监控类，封装连接/重连/状态管理/切换指令 (~280行) |
| `src/main/main.ts` | 修改 | 6 个 ATEM IPC 通道 + `injectATEMState()` + 全局快捷键 |
| `src/main/preload.cts` | 修改 | 暴露 6 个 ATEM API |
| `src/renderer/ipc.ts` | 修改 | `ObsGuardApi` 类型扩展 |
| `src/main/obsMonitor.ts` | 修改 | `getSnapshot()` 添加 ATEM 默认值 |
| `src/renderer/components/settings/SettingsSections.tsx` | 修改 | `ATEMSection` 组件：IP 输入、检测连接按钮、状态指示器 |
| `src/renderer/components/SettingsPanel.tsx` | 修改 | ATEM 导航项、条件渲染、5 次点击开发者模式 |
| `src/renderer/main.tsx` | 修改 | Dashboard ATEM 卡片、键盘事件处理 |
| `src/renderer/styles/settings.css` | 修改 | `.beta-badge`、动画 `@keyframes spin/pulse` |

---

## 5. 开发者模式

ATEM 功能默认为 Beta，**全部 UI 隐藏**。

**解锁方式：** 设置 → 点击左侧 "关于" **5 次**（2 秒内）

解锁后出现：设置导航 `ATEM 导播台 BETA`、ATEM 设置区块、仪表盘卡片、`DEV` 页头标识。再次 5 次关闭。

---

## 6. 快捷键规范

| 按键 | 全局模式 | 应用内模式 |
|------|----------|------------|
| Num1-9 | `globalShortcut` → 选 Preview 机位 | `keydown` → 选 Preview 机位 |
| Enter | — | 执行 AUTO 过渡 |

---

## 7. IPC 接口

| 通道名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| `atem:get-state` | — | `ATEMStateSnapshot` | 当前状态 |
| `atem:change-preview-input` | `input` | `void` | 选 Preview |
| `atem:auto-transition` | — | `void` | 执行 AUTO |
| `atem:change-program-input` | `input` | `void` | 硬切（备用） |
| `atem:test-connection` | `host` | `ATEMTestResult` | 测试连接 |
| `atem:reconnect` | — | `void` | 手动重连 |

---

## 8. 当前状态与待办

| 项目 | 状态 |
|------|------|
| TypeScript 编译 | ✅ |
| Vite 构建 | ✅ |
| 代码实现 | ✅ |
| 实机测试 | ⬜ 需要 ATEM 硬件 |
| 自动发现（mDNS） | ⬜ |
| 硬切模式 | ⬜ |
| 持久化开发者模式 | ⬜ |

---

## 9. 测试计划（需要 ATEM 硬件）

1. **连接测试**：输入 IP → 检测连接 → 验证设备型号和输入路数
2. **状态同步**：切换 PGM/PVW → 验证 UI 实时更新
3. **快捷键**：Num 选 PVW、Enter 执行 AUTO → 验证切换正确
4. **全局快捷键**：切换到其他应用 → 验证 Num 键仍生效
5. **断线重连**：拔网线 → 验证红色错误状态 → 验证重连按钮
6. **开发者模式**：5 次点击"关于" → 验证显示/隐藏切换
