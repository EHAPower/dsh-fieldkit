# eha-tool WebUI 维护说明

2026-10-14 的最终决定是：Fieldkit 冻结，SDK 中为 DSH 增加的支持已撤销，`eha-tool webui` 恢复并继续维护。此前针对 WebUI 的冻结、弃用及未来删除计划已撤销；DSH 不再承担 EHA 图形界面迁移目标。

## 维护范围

- WebUI 的功能、专属实现、页面资源和测试可继续在 eha-sdk 中更新。
- WebUI、CLI 与 Shell 继续复用 SDK；保留独立的 ODrive 只读桥接退出与诊断修复。
- Fieldkit 不再开发或维护，不要求把 WebUI 功能同步到插件。

为 DSH 引入的独立服务、集成接口、`serve --direct-api` 及配套调度已从 SDK 撤销，Firmware 已更新 SDK 引用。原 CLI、Shell 和 WebUI 后端结构已恢复，既有历史数据和验收记录保留。当前插件不兼容撤销后的 SDK，重启 DSH 或服务不能恢复兼容性。

## 历史决定

此前曾计划由 DSH 承担唯一图形界面，随后将 WebUI 标记冻结、弃用并计划未来删除；这些要求均已撤销。中间阶段“WebUI 与 DSH 插件并存维护”的方向也已被最终冻结 Fieldkit、撤销 SDK DSH 支持的决定替代。

[迁移记录](eha-migration-progress.md)、[用户旅程](eha-user-journey.md)和[命令工作台计划](superpowers/plans/2026-10-14-eha-command-workbench.md)保留当时的实现与验收事实，不再构成当前开发或验收任务。
