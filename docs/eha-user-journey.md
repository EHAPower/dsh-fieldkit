# EHA 命令工作台用户旅程（历史验收）

**最终状态（2026-10-14）：Fieldkit 已冻结，SDK 的 DSH 支持已撤销，`eha-tool webui` 继续维护。** 以下清单仅记录冻结前的验收范围和结果，不是当前操作指南或待执行任务。

该清单曾替代旧 P0–P6 迁移矩阵中的额外门禁、强制 WebUI 删除与多轮硬件验收要求。当时配套 SDK `c95bbce` 已提交并通过 devbox 完整 `scripts/check.py`；nzh-mbpm1 的原生 aarch64 release 构建和完整 Python runtime 发行包已完成。插件的 `npm run build`、`npm test`（34/34）和 `npm pack` 已通过，前后端最终审查均为 Approve，且已安装到既有官方 DSH profile。下列条目保留实际结果；未执行的运动、维护写入和群组硬件操作不补写为通过。

## 当时的共同约定

- 使用实际打包插件、未修改的官方 DSH 和目标主机上的原生 eha-tool。
- 插件通过 `eha-tool serve --direct-api` 调用既有 Workbench / ToolSession `/api`；不复制协议或命令含义。
- 每次表单执行只发送用户选择的一个官方命令及其参数。插件不补发读回、授权、占用、Stop 或恢复命令。
- 服务原始结果、错误和 unknown 都显示在当前命令结果中。unknown 不成为下一次命令的插件前置条件。
- `fieldkit_context` 只显示当前目标、内存中的最近一次原始命令结果 `lastResult` 和静态完整命令目录；它不恢复历史工作流状态。
- Bearer/token 只在插件后端与本机服务之间传输。它不出现在浏览器、模型、报告或截图中。

## 核心旅程及当时结果

| 编号 | 操作 | 预期结果 | 状态 |
| --- | --- | --- | --- |
| W01 安装 | 升级既有官方 `fieldkit-migration` profile 中的插件包并打开工作台 | 官方 DSH `0.2.0-rc.2` 未改，工作台可打开 | 通过；这是既有 profile 升级，不是干净环境首次安装 |
| W02 启动或附着 | 在工作台点击服务按钮启动 `serve --direct-api` | direct 实例 `i-350ba1173774fe6725dca46a75edfce3` 启动，source 为 clean aarch64 `c95bbce` | 通过 |
| W03 选择目标 | 枚举 USB，选择真实设备并连接 | connect HTTP 200；初始展开的连接表单在选定后折叠，顶部目标与直接 Stop 保留 | 通过 |
| W04 执行命令 | 执行 action status | 后端以固定 API 请求转发，status HTTP 200 | 通过 |
| W05 反馈 | 查看成功和普通错误结果 | action status 返回 HTTP 200 原文和摘要；`config_validate('{}')` 忠实返回 HTTP 409 `invalid_input` / `format_version required`，不改写为设备完成结论 | 通过；私有 UI/原始错误/截图证据已保存 |
| W06 unknown 后继续 | 先得到 unknown，再提交下一条命令 | 新表单仍可执行 | 合成测试通过；本轮未在实板制造 unknown |
| W07 对话解释 | 在同一工作台询问刚才的 status 结果 | 真实模型仅调用 `fieldkit_context`，正确解释最近结果 200/status/Idle；tool trace 已确认 | 通过 |
| W08 生命周期 | 刷新页面 | USB 目标和对话恢复，服务保持运行 | 通过 |
| W09 原生验证 | 在 nzh-mbpm1 运行原生 eha-tool，并转发到本机后手动使用工作台 | 实际 UI 完成 W02–W08 的已列范围 | 通过；不含运动、维护写入或群组硬件操作 |
| W10 普通错误后继续 | 在 `config_validate('{}')` 返回错误后执行 status | 无恢复或批准即可返回 HTTP 200 | 通过 |

## 当时的交付顺序

1. 代码完成固定命令桥接和命令表单。
2. 在 devbox 运行相关构建与测试。
3. 进行独立代码审查。
4. 将配套原生 eha-tool 和插件部署到 nzh-mbpm1。
5. 通过本机转发实际手动试用 W01–W09。
6. 以相互独立的本地提交保存 SDK、插件和父仓库改动。

迁移已终止，上述顺序仅作历史记录。旧 P0–P6 矩阵和私有审计产物继续保留，未执行事项不会因仓库冻结而变为已通过。
