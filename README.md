# @ehapower/dsh-fieldkit

面向现场支持人员的 DeepSeek Harness 插件。默认进入 EHA 工作台：点击按钮选择目标、查看缓存、执行只读诊断、检查配置记录并保存证据；右侧保留原生对话，用于提问和解释结果。按钮操作不需要模型调用。

设备连接和协议由公开 [`eha-sdk`](https://github.com/EHAPower/eha-sdk) 的官方 `eha-tool` 持有。按钮与对话工具共用一个 Fieldkit 服务，按对话保存目标绑定。本阶段只接入 EHA，不包含设备写入、运动、停止、复位或维护入口。

## 兼容范围

| 组件 | 本版本要求 |
| --- | --- |
| DeepSeek Harness | `0.2.0-rc.2`，保持精确版本；其他版本需要重新验证。 |
| eha-tool 持久服务 | 支持 `eha-tool.integration.v1`、DTO 版本 1、配置格式版本 1。 |
| 主机 | 持久服务的凭据文件校验面向 macOS / Linux；开发和软件验证在 devbox 中执行。 |
| 旧 eha-tool | 可显式选择 `legacy-cli`，使用原有六次 USB CLI 采集。不会自动回落此模式。 |

持久服务依赖本次配套的 eha-tool 改动。该改动合入公开 SDK 前，不能假定公开 `main` 或已安装的旧二进制包含 `/integration/v1`。

DSH 的 Host / Client、面板和 Remote 使用发布包提供的接口。rc.2 的官方 Typert 生成器存在第三方 npm 协议符号识别缺口，本包在构建时应用一个限定版本的兼容补丁；DSH 运行时保持原样。Remote 类型从公开子路径导出，Client 按官方延迟 CJS 工厂格式打包。构建遇到不匹配的生成器版本应停止，不能静默生成不完整清单。

## 构建与安装

在开发容器中执行：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm pack --ignore-scripts
```

在独立的 `fieldkit` profile 中安装生成的 `.tgz`，将路径替换为本机实际路径：

```sh
dsh --version
dsh --profile fieldkit --from-default-profile web --help
dsh plugin --profile fieldkit add /absolute/path/to/ehapower-dsh-fieldkit-0.2.0.tgz
```

本包提供专用 Fieldkit Agent preset，关闭此 profile 的通用编程 preset，并限制模型可用的工具和 SOP。模型服务仍由 DSH 配置；创建空会话需要有效的默认模型配置和预设，发送问题才需要对应凭据。

## 启动官方工具

先从包含本次集成接口的 SDK 源码构建 `eha-tool`：

```sh
cargo build -p eha-tool --release --locked
```

使用仓库外的私有目录保存凭据，显式启用集成入口：

```sh
eha-tool webui --port 8080 --integration-token-file /absolute/private/eha-integration.token
```

eha-tool 首次创建凭据文件，之后重启复用合规文件；Unix 权限为 `0600`。每次进程启动产生新的实例标识，重启后需要重新选择目标。凭据仅由 Fieldkit 后端读取，不传给浏览器、模型或报告。

在 DSH 的 Plugins / Settings 中填写本地 `fieldkit` 配置：

| 字段 | 用途 |
| --- | --- |
| `deviceMode` | 默认 `integration`；兼容旧工具时显式设为 `legacy-cli`。 |
| `integrationUrl` | 官方服务实际回环地址，例如 `http://127.0.0.1:8080`。 |
| `integrationTokenFile` | 上述凭据文件的绝对路径。 |
| `toolPath` | 官方 eha-tool 的绝对路径；离线配置检查和 legacy 模式使用。 |
| `reportsDir` | 保存 Markdown / JSON 诊断报告的绝对目录。 |

然后启动 Harness：

```sh
dsh --profile fieldkit --no-open
```

Fieldkit 不启动或结束持久 eha-tool 进程。未配置服务、版本不匹配或连接失败时，工作台显示原因并停止对应操作。服务地址只接受本机回环地址，禁止重定向；不使用官方 WebUI 未版本化的内部 `/api/*` 路由。

## 工作台流程

1. 刷新目标列表，明确选择目标。USB 候选可显式连接；官方工具已经连接的 USB / CAN 会话可附着。不会自动选取第一台或扫描 CAN 总线。
2. 核对目标、UID、`run_nonce` 和连接代次。缓存观察不发送主动查询；缺少新鲜遥测、控制请求未决或身份变化时，主动诊断不可用。
3. 点击诊断。依次保留绑定身份快照、状态、测量、诊断、Startup 配置和 user 配置。首次失败或身份变化即停止后续读取，并保留部分证据。
4. 查看步骤结果和本机报告。切换目标产生新绑定，旧运行记录继续归属于原目标；不同对话不会共享一个可变的“当前设备”。
5. 需要解释时在右侧提问，或使用 `/connect-check`、`/state-triage`、`/configuration-review`。对话工具使用当前对话的绑定，不能凭另一对话的运行编号或报告路径取得结果。

离线配置检查接受完整 JSON 原文，通过官方 `config-check` 执行，不访问设备。原文不先经 JavaScript 数值转换再写回；从设备得到的 `native_json_text` 也保留原文，大整数不会因展示而改写。

取消采集只阻止后续步骤；在持久服务模式下，取消选择、切换页面和关闭面板均不发送 Stop，不关闭官方设备连接。浏览器 Remote 中的会话 ID 是同一操作员下的路由参数，不是不同操作员之间的访问控制边界。

## 对话工具

| 工具 | 作用 |
| --- | --- |
| `fieldkit_devices()` | 返回候选和当前对话选择；枚举本身不等于已连接或身份核对。 |
| `fieldkit_diagnose({ bindingId })` | 对当前对话的精确绑定执行六个证据步骤，保存完整或部分报告。默认模式使用。 |
| `fieldkit_diagnose_usb({ serial })` | 仅在 `legacy-cli` 模式注册，保留原有六次独立 USB CLI 采集。 |
| `fieldkit_check_configuration({ record })` | 对用户提供的完整配置记录执行官方离线检查，优先传原始 JSON 文本。 |

legacy 模式应与持久 owner 分开使用，不能同时争用同一设备。它没有持久绑定读取的语义；报告会标明来源。两种模式的失败都不会自动重试。

## 证据边界

“采集完整”只说明本次六个证据步骤成功、身份和运行实例连续。不同读取没有共同的原子时刻，也不代表连续监控、设备安全或机构动作。静态配置检查通过不证明设备已采用配置。

eha-tool 当前主动 SDK 查询会同步占用官方 WebUI 循环，单次等待上限为 5 秒；本阶段拒绝在已知活动控制或状态不明时开始读取，但不承诺查询期间的 Stop 抢占，也不约束外部 CAN 发送者。

同一个 eha-tool 进程曾尝试普通目标控制后，只读集成会保持 `unresolved_target`，仍可查看缓存。仅凭本地 Stop 提交或随后收到的 Idle 遥测，无法证明设备已处理停止，因此本阶段不会自动解除这项主动读取限制。

设备和工具文本是待分析证据，不是可执行指令。模型报告应区分事实、推断和待确认项，并引用步骤、接收时间与身份。设备标识和选定证据在提问时可能进入所配置的模型服务；真实凭据、设备报告和站点配置应保留在仓库外。
