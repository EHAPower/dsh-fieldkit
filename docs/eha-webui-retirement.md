# 旧 WebUI 退役准备

当前保留旧 WebUI，不执行删除。P1 原生只读旅程已验证，P2 至 P4 仍在实施与验收中；P5 尚未完成真实退役候选周期，之后的下一次明确破坏性发布也尚未确定。没有删除日期或完整迁移完成声明。阶段依据见[迁移进度](eha-migration-progress.md)、[用户旅程](eha-user-journey.md)与[迁移计划 P5 / P6](superpowers/plans/2026-10-13-eha-dsh-ui-migration.md)。

## 必须先满足的门槛

以下条件全部成立，才可在 P5 真实退役候选周期之后的下一次明确破坏性发布删除页面：

1. 旧 UI 每项能力迁入 Fieldkit，或由用户明确决定取消，功能对照和完整操作员验收没有遗漏。
2. 插件、CLI 和服务共享单一执行实现，身份、连接代次、数值采用和结果未知语义一致。
3. P4 的查询、心跳、Stop 和试验截止调度门槛及 USB / CAN 实板工作流通过；旧页面不承担未迁移功能的长期补救入口。
4. 服务和 CLI 不依赖 DSH 运行，模型或宿主故障不改变服务生命周期。
5. 首个交付平台的原生安装、启动、导出、升级和迁移通过；其他承诺支持的平台分别完成验收。官方 Desktop 不能用 npm DSH Web 的结果代替。
6. 配置原文、连接档案和历史 runs 保持可读取；可回退旧发行包且不会自动连接或重放动作。
7. 全部 EHA 产品界面由插件提供，干净官方宿主可安装、运行、升级和卸载；没有宿主分支、包补丁或私有扩展点。

仅软件测试、构建、P1 服务抽离或 P2 只读面板通过，都不启动删除。P5 必须记录实际候选版本与完整默认入口使用周期；P6 必须再记录下一破坏性发布的版本和兼容决定，不以预定日期替代验收。

## 当前 SDK 的删除准备清单

以下是当前源码中的候选及调用者，均须在最终候选重新核对消费者。它们不是本次删除指令。SDK 路径相对于官方 [eha-sdk 仓库](https://github.com/EHAPower/eha-sdk)。

| 当前文件 / 调用者 | 删除阶段的处理 |
| --- | --- |
| `crates/tool/webui/static/` | 页面 HTML、CSS、图标及 `app.js`、`telemetry.js`、`config-editor.js`、`can-connection-ui.js`、`recording-ui.js`、`trial-ui.js`、`trial-state.js` 的能力全部覆盖后，移除旧静态资源 |
| `crates/tool/src/webui.rs` | 当前已是兼容适配器，包含 `ASSETS` / `static_response`，`serve` 转交 `service::serve_webui`；与调用者一起拆除页面职责，不能照搬计划中“仍混合主服务”的旧描述 |
| `crates/tool/src/main.rs` | `mod webui`、`Command::Webui` 与 `webui::serve` 调用需按发布兼容决定处理；保留独立 `Serve`、CLI 与 Shell |
| `crates/tool/src/service.rs` | 移除旧页面所需的 `webui::{StaticResponse, static_response}` 和页面路由；`serve_webui` / `legacy_routes` 的兼容逻辑随旧命令决定调整，保留独立服务入口与认证 |
| 同文件旧 `/api/*` 适配器 | 在消费者确已清空后处理；当前旧 `app.js` 使用连接、枚举、快照、ODrive、动作与 CAN 路由，`config-editor.js` 使用 schema 路由，`recording-ui.js` 使用记录列表 / 文件 / 动作路由，`trial-ui.js` 使用单台与群组试验路由 |
| `crates/tool/webui/tests/` | 当前五项前端测试为 `telemetry`、`config-editor`、`can-connection-ui`、`recording-ui`、`trial-state`；只删除随页面消失的测试，迁移后的合同保护归插件与服务测试 |
| `crates/tool/webui/package.json`、`package-lock.json`、`scripts/vendor-echarts.mjs` | 当前只管理旧前端 ECharts vendor；确认无其他消费者后移除。插件自身的依赖与许可独立保留 |
| `crates/tool/webui/static/vendor/` | 清理旧页面副本前核对 ECharts、d3、tslib、zrender 许可及 NOTICE；插件仍使用 ECharts，不能同时删除插件所需许可 |
| SDK `scripts/check.py` | 当前显式枚举旧前端 `*.test.js`；删除该测试入口，保留数值、Rust、Python、SDK、工具与原生构建检查 |
| SDK `scripts/package_tool.py` | 按新工具重建原生完整发行包；该脚本仍用于私有 CAN runtime 打包，不因静态页面删除而废弃 |

`service.rs` 内还有使用旧 `/api/*` 的 Rust HTTP、来源校验和 ODrive 隔离测试。删除适配器时逐项判断哪些是页面专用测试，哪些仍保护 v1 / v2 的认证、慢请求隔离和唯一 owner；不能批量删除整个服务测试模块。

## 必须保留的实现与用户资料

保留 `crates/tool/src/service.rs` 和 `src/service/` 下的 Workbench、认证、v1 / v2、实例发现、事件、查询与调度实现；保留 `session.rs`、`owner_lock.rs`、`service_client.rs`、`device_commands.rs`、`shell.rs`、`connections.rs`、`runtime.rs`、配置检查、trial、recording、ODrive 和 SDK。清理页面代码不能改变单一连接持有、显式重连、不自动恢复心跳或目标、不自动重试未知效果等边界。

`/integration/v1` 的兼容期独立于 HTML 生命周期。不能因删除旧 `/api/*` 顺带破坏已发布 v1 客户端，也不能借退役强制删除显式 CLI 模式。协议细节仅以配套 SDK 中的 `crates/tool/service-api.md`为准。

保留每用户连接档案、配置原文及历史记录，包括 runs 的 metadata、events 与 telemetry。目录迁移和格式转换须保留原文与可回退副本；不因安装新 UI 清理原有用户资料。完整旧 SDK 发行目录可用于回退，但回退启动不得自动重放操作。

## 文档、命令与交付联动

当前需同步的真实引用包括 SDK `README.md`（工具入口与数值边界）、`crates/tool/README.md`（WebUI 使用、v1 附着、架构图和生命周期）、`CONTRIBUTING.md`（旧前端测试与 vendor 开发）、`AGENTS.md`（工具复用边界）、`CAN接入指南.md`（旧 WebUI CAN 网络切换）和 SDK `scripts/check.py`。未来删除候选须重新检索真实调用脚本，不能只改这些已知文件。

撤销 `eha-tool webui` 页面功能时，发行说明需明确迁移提示的兼容周期，以及是否保留指向独立服务的别名；当前不预先承诺别名。更新 Fieldkit 的安装指南、功能映射、SOP 与宿主兼容表，协议内容不复制到插件文档。

最终验收须用不含旧页面的实际原生发行包，在官方 DSH 完成全部默认入口旅程，并证明独立服务、CLI、历史记录与回退仍可用；原生打包、许可和插件安装包各自检查。旧 UI 在候选周期中只用于明确的问题定位，缺失能力必须迁移或由用户明确取消。

## 尚待填写的版本与证据

| 项目 | 当前状态 |
| --- | --- |
| P5 完整退役候选：官方宿主 / 插件 / 原生 SDK 的精确版本与平台 | 待完整验收后填写；P1 的阶段组合不能代替 |
| 真实默认入口使用周期与全部旅程结果 | 未完成，尤其 P2 至 P4 和升级保留 |
| P6 下一次明确破坏性发布版本 | 待 P5 周期完成后决定 |
| 旧命令迁移提示、别名与 v1 兼容决定 | 待发布决定 |
| 删除后的实际安装包、原生发行包与独立 CLI / 服务结果 | 待删除候选形成后验收 |

本说明只准备范围与门槛，不删除文件、不更改旧 UI、不宣布 P5 或 P6 完成。
