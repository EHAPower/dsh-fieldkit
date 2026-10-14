# EHA 命令工作台迁移记录（已冻结）

**最终状态（2026-10-14）：Fieldkit 已冻结；SDK 的 DSH 支持已撤销；`eha-tool webui` 恢复并继续维护。** 相关服务、实例及本机转发已停止。插件不再兼容撤销 DSH 支持后的 SDK，重新启动服务不能恢复兼容性。

原迁移目标是在未修改的官方 DSH 中提供插件工作台，连接 `eha-tool serve --direct-api` 的 Workbench / ToolSession，显示命令表单和原始结果。该目标现已终止。下面保留当时的部署和验收事实，不表示插件当前仍可用或需要继续验收。

## 冻结前的部署与验收

当时配套 SDK `c95bbce` 已提交并通过 devbox 完整 `scripts/check.py`；nzh-mbpm1 的原生 aarch64 release 构建和完整 Python runtime 发行包已完成。插件在 devbox 的 `npm run build`、`npm test`（34/34）和 `npm pack` 已通过，最后的界面收口另以定向测试验证，前后端最终审查均为 Approve，并已安装到 nzh-mbpm1 的既有 `fieldkit-migration` profile。实际 UI、原始错误反馈和截图已保存。这些结果只适用于当时列出的版本和范围。

| 事项 | 当时状态 | 证据与范围 |
| --- | --- | --- |
| 官方 DSH | 已验证 | `0.2.0-rc.2` 未改；插件通过官方 `dsh plugin` 命令安装到既有 profile。 |
| 配套 SDK | 已完成 | `c95bbce` 已提交，devbox 完整 `scripts/check.py` 通过；nzh-mbpm1 原生 aarch64 release 与完整 Python runtime 发行包已完成。 |
| 直接 API 桥接 | 已验证 | 工作台按钮启动 direct 实例 `i-350ba1173774fe6725dca46a75edfce3`，source 为 clean aarch64 `c95bbce`。 |
| 命令工作台 | 已验证范围 | 已枚举 USB、选择真实设备、连接 HTTP 200；action status 返回 HTTP 200 原文和摘要；`config_validate('{}')` 忠实返回 HTTP 409 `invalid_input` / `format_version required`，后续 status 无恢复或批准即返回 HTTP 200。 |
| 插件状态删除 | 已完成 | 授权、占用、恢复账本与 unknown 后续锁已从插件删除。 |
| unknown 呈现 | 合成验证 | unknown 后下一命令可执行由合成测试证明；本轮没有在实板制造 unknown。 |
| 命令上下文 | 已验证范围 | `fieldkit_context` 提供当前目标、内存 `lastResult` 和静态完整命令目录；真实模型仅调用该工具，并正确解释最近 status/200/Idle。 |
| 本机服务凭据 | 已验证 | 后端测试和独立审查确认 Bearer/token 仅在本机服务传输，不进入 UI 或模型。 |
| devbox 验证 | 已完成 | `npm run build`、`npm test` 34/34、`npm pack` 全部通过。 |
| 独立审查 | 已完成 | 前后端最终审查均为 Approve。 |
| nzh-mbpm1 手动试用 | 已验证范围 | 服务启动、USB 选择/连接、status、无效配置错误、后续 status、模型上下文和页面刷新恢复已完成；私有证据位于 `.dsh/command-workbench-evidence/`。 |
| 本地提交 | 当时分阶段保存 | SDK `c95bbce`；插件保存命令工作台改动，父仓仅更新 SDK gitlink。 |

此前验收中，页面刷新后 USB 目标和对话均恢复，服务保持运行。旧 reset unknown 原回执已另存私有 archive，当时未改写其结论；运动、维护写入和群组硬件操作均未执行。2026-10-13 P0–P6 计划、验收矩阵、私有审计产物及[命令工作台计划](superpowers/plans/2026-10-14-eha-command-workbench.md)均保留为历史记录，不再定义当前交付或后续验收要求。
