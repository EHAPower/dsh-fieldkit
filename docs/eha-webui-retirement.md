# 旧 eha-tool WebUI 冻结说明

`eha-tool webui` 已冻结并弃用。它在当前发行中仍可运行，供既有用户继续使用；本次命令工作台迁移不会删除、禁用或修改它。

## 冻结范围

- 不再为旧页面新增功能。
- 不再更新仅服务于旧页面的实现、页面资源或页面测试。
- 不把插件的新功能回填到旧页面。
- 不把 WebUI 的可用性当成插件交付、验收或故障恢复前置条件。

冻结不包含独立 `eha-tool` 服务、CLI、Shell、SDK 共享实现、历史数据或命令语义；这些仍是插件所复用的官方能力。

## 后续删除

旧 WebUI 计划在未来的 SDK 独立发布中删除。删除工作届时再根据实际消费者、发布兼容说明和 SDK 代码制定，不预先承诺日期、版本或别名。本次不删除文件、路由、命令、用户配置、历史 runs 或第三方许可。

插件的当前交付是接入 `eha-tool serve --direct-api` 的 Workbench / ToolSession，而不是替旧 WebUI 维护另一份页面功能。具体实施状态见[迁移进度](eha-migration-progress.md)与[命令工作台计划](superpowers/plans/2026-10-14-eha-command-workbench.md)。
