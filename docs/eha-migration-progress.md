# EHA 命令工作台进度

当前目标已改为：在未修改的官方 DSH 中提供简单的插件工作台，连接 `eha-tool serve --direct-api` 的既有 Workbench / ToolSession，显示官方命令表单并忠实反馈每次执行的原始结果。

**状态：新版已部署，可手动试用。** 配套 SDK `c95bbce` 已提交并通过 devbox 完整 `scripts/check.py`；nzh-mbpm1 的原生 aarch64 release 构建和完整 Python runtime 发行包已完成。插件在 devbox 的 `npm run build`、`npm test`（34/34）和 `npm pack` 已通过，最后的界面收口另以定向测试验证，前后端最终审查均为 Approve，并已安装到 nzh-mbpm1 的既有 `fieldkit-migration` profile。实际 UI、原始错误反馈和截图已保存。本页不把旧 service-v2、旧 WebUI 或历史审计证据重写为新目标的完成证据。

| 事项 | 当前状态 | 后续工作 |
| --- | --- | --- |
| 官方 DSH | 已验证 | `0.2.0-rc.2` 未改；插件通过官方 `dsh plugin` 命令安装到既有 profile。 |
| 配套 SDK | 已完成 | `c95bbce` 已提交，devbox 完整 `scripts/check.py` 通过；nzh-mbpm1 原生 aarch64 release 与完整 Python runtime 发行包已完成。 |
| 直接 API 桥接 | 已验证 | 工作台按钮启动 direct 实例 `i-350ba1173774fe6725dca46a75edfce3`，source 为 clean aarch64 `c95bbce`。 |
| 命令工作台 | 已验证范围 | 已枚举 USB、选择真实设备、连接 HTTP 200；action status 返回 HTTP 200 原文和摘要；`config_validate('{}')` 忠实返回 HTTP 409 `invalid_input` / `format_version required`，后续 status 无恢复或批准即返回 HTTP 200。 |
| 插件状态删除 | 已完成 | 授权、占用、恢复账本与 unknown 后续锁已从插件删除。 |
| unknown 呈现 | 合成验证 | unknown 后下一命令可执行由合成测试证明；本轮没有在实板制造 unknown。 |
| 命令上下文 | 已验证范围 | `fieldkit_context` 提供当前目标、内存 `lastResult` 和静态完整命令目录；真实模型仅调用该工具，并正确解释最近 status/200/Idle。 |
| 旧 WebUI | 冻结、保留 | 已弃用，仍可用；本次不删除或更新。 |
| 本机服务凭据 | 已验证 | 后端测试和独立审查确认 Bearer/token 仅在本机服务传输，不进入 UI 或模型。 |
| devbox 验证 | 已完成 | `npm run build`、`npm test` 34/34、`npm pack` 全部通过。 |
| 独立审查 | 已完成 | 前后端最终审查均为 Approve。 |
| nzh-mbpm1 手动试用 | 已验证范围 | 服务启动、USB 选择/连接、status、无效配置错误、后续 status、模型上下文和页面刷新恢复已完成；私有证据位于 `.dsh/command-workbench-evidence/`。 |
| 本地提交 | 本轮分阶段保存 | SDK `c95bbce`；插件保存命令工作台改动，父仓仅更新 SDK gitlink。 |

页面刷新后，USB 目标和对话均恢复，服务保持运行。旧 reset unknown 原回执已另存私有 archive，本轮未改写其结论；运动、维护写入和群组硬件操作均未执行。旧 2026-10-13 P0–P6 计划、验收矩阵和私有审计产物继续保留，用于解释历史实现与证据；它们不再要求本轮完成额外准入、未知锁、旧 WebUI 强制删除或多轮硬件门槛。新工作定义见[命令工作台计划](superpowers/plans/2026-10-14-eha-command-workbench.md)。
