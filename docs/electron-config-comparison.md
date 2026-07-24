# Electron 配置对照结论

对照对象：VS Code、Element Desktop、Signal Desktop、Logseq、GitHub Desktop，以及 electron-vite 官方 boilerplate。  
对照范围：本仓库 `apps/desktop` 的 `BrowserWindow` / 安全基线、`electron.vite.config.ts`、`electron-builder.yml`。  
日期：2026-07-21。

## 总判断

安全基线已经比多数知名 Electron 项目更干净；缺口主要在窗口行为与打包成熟度，不是 `webPreferences` 方向错了。

不要被「大项目却关 sandbox」带偏：GitHub Desktop / Signal 主窗 / Logseq / electron-vite 模板的部分选择是历史包袱或能力权衡，不是当前推荐默认。

## 安全 / BrowserWindow

| 项 | PIE（本项目） | VS Code | Element | Signal（主窗） | Logseq | GitHub Desktop | electron-vite 模板 |
|---|---|---|---|---|---|---|---|
| `contextIsolation` | ✅ true | ✅（默认） | ✅ true | ✅ true* | ✅ true | ❌ false | 默认 true |
| `nodeIntegration` | ✅ false | ✅ false | ✅ false | ✅ false | ✅ false | ❌ true | 默认 false |
| `sandbox` | ✅ true | ✅ true | ✅ `app.enableSandbox()` | ❌ false（副窗才 true） | ❌ false | 实际关掉 | ❌ 显式 false |
| CSP | ✅ meta | 自有方案 | 自有 | 自有 | 偏松 / dev 关 webSecurity | — | 常见有 |
| 权限默认拒绝 | ✅ | 细粒度 | 细粒度 | 细粒度 | — | — | 少见 |
| `setWindowOpenHandler` | ❌ 缺 | ✅ | ✅ | ✅ | 有外链处理 | — | ✅ |

\*Signal 测试环境会关掉 isolation。

要点：

- 本项目 preload 走 `.cjs`，因此可以开 `sandbox: true`，与 VS Code / Element 同档。
- electron-vite 官方样板为省事写了 `sandbox: false`；不要学。
- GitHub Desktop 的 `nodeIntegration: true` + `contextIsolation: false` 是历史包袱；不要学。

## 构建 / 打包

| 项 | PIE | electron-vite 模板 | Logseq |
|---|---|---|---|
| 构建 | electron-vite → `out/` | 同系 | 自研 + electron-builder |
| builder `files` | 只打 `out/**`（干净） | 否定源码/配置的长 exclude | 复杂 include/exclude + native |
| asar | ✅ | ✅ + `asarUnpack` | ✅ |
| 签名 / 公证 / entitlements | ❌ 未配 | 模板有 mac entitlements 位 | ✅ hardenedRuntime + entitlements |
| 图标 / artifactName | ❌ | 有 | 有 |
| auto-update | ❌ | publish 占位 | electron-updater |
| 窗口状态记忆 | ❌ | 可选 | electron-window-state |

`files: out/**` 比模板「打整个包再 exclude」更合适，早期保持即可。

## 建议

### 现在值得补（小、安全相关）

1. `webContents.setWindowOpenHandler`：外链走 `shell.openExternal`，其余 `deny`（Signal / Element / electron-vite 都有）。
2. （可选）`app.enableSandbox()` 全局开启，避免以后临时窗漏配（Element 做法）。

### 发版前再加

- `electron-window-state`（位置 / 大小）
- mac entitlements / notarize、图标、`artifactName`
- `electron-updater`（太早加容易空转）

### 刻意不学

- GitHub Desktop 的 `nodeIntegration: true`
- electron-vite 模板的 `sandbox: false`
- Signal 主窗关 sandbox（历史 / 能力权衡）
- `bytecodePlugin`（混淆用，开源项目通常不需要）

## 本项目相关文件

- `apps/desktop/src/main/index.ts` — BrowserWindow / session 权限
- `apps/desktop/electron.vite.config.ts` — main ESM / preload CJS / renderer
- `apps/desktop/electron-builder.yml` — 打包
- `apps/desktop/src/renderer/index.html` — CSP
- `apps/desktop/README.md` — 模块格式与 sandbox 约定
