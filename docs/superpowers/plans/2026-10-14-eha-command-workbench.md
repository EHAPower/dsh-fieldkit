> **历史归档，已终止（2026-10-14）。** 本计划记录当日命令工作台的实现与验收安排，不再定义当前交付、接口合同或后续工作。Fieldkit 已冻结，SDK 与 Firmware 中为 DSH 提供支持的修改已撤销。`eha-tool webui` 继续使用和维护；以下内容只保留为历史验收记录。

# EHA 命令工作台实施计划（历史归档，已终止）

**历史目标：** 在未修改的官方 DSH 中提供简单的 EHA 命令工作台：选择目标、填写官方命令表单、执行并显示 eha-tool 的原始 HTTP 返回。

**历史边界：** 插件通过 `eha-tool serve --direct-api` 使用既有 `/api` Workbench / ToolSession，不复制设备协议或追加设备命令。唯一执行接口为 `executeCommand(sessionId, { command, bodyText, queryText })`，返回 `{ command, method, path, status, ok, bodyText, receivedAt }`；模型工具为 `fieldkit_context` 和 `fieldkit_command`。`fieldkit_context` 只提供当前目标、内存中的最近一次原始命令结果 `lastResult` 和静态完整命令目录。Bearer/token 只在插件后端使用。插件移除 grant、reservation、claim、scope、epoch、journal 及 unknown 后续锁；unknown 仅保留在本次原始响应中。当时已撤销 `eha-tool webui` 的冻结、弃用及未来删除计划；WebUI 继续使用和维护。

以下检查按 SDK → 插件 → 父仓库的整体顺序完成；官方 DSH 不改。

1. **直接 API 与服务生命周期**：原生 eha-tool 以固定参数数组启动 `serve --direct-api`；插件后端认证并调用已固定的 `/api` 路径。Remote DTO、浏览器、模型返回和报告均不含 token。
2. **命令工作台**：`src/commands.js` 只解析固定官方命令与原始 `bodyText`/`queryText`；`src/client/CommandWorkbench.ts` 在一个界面提供目标选择、命令表单、执行按钮和 `{ status, ok, bodyText }` 原始结果。HTTP 结果不改写为 stdout/stderr 或设备完成结论。
3. **删除额外插件状态层**：删除或断开 P2/P3/P4 的 grant、reservation、claim、scope、epoch、mutation/recovery journal 与恢复 UI；插件历史 unknown 不禁用下一条 `fieldkit_command`。保留离线 `fieldkit_check_configuration`、官方 recording 下载和原生 eha-tool 命令语义。
4. **软件验证与独立审查**：在 devbox 对实际改动运行相关测试、`npm run build` 和 `npm pack`，再由独立审查确认固定 API 路径、参数原文、token 边界、状态层删除和 unknown 后续执行。不要重复未变化输入的验证。
5. **原生试用与交付**：在 nzh-mbpm1 部署配套原生 eha-tool 与插件包，转发本机回环服务后手动完成安装、附着、选目标、执行命令、原始反馈、unknown 后继续与重开界面。把实际结果写入进度与旅程文档；随后按实际改动在 SDK、插件、父仓库分阶段本地提交，不自动 push。

本计划在当时替代[2026-10-13 旧迁移计划](2026-10-13-eha-dsh-ui-migration.md)。两份计划现均已终止归档；旧 P0–P6、WebUI 强制删除、多轮硬件门槛和历史审计产物均保留为历史记录。
