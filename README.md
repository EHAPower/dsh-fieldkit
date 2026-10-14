# @ehapower/dsh-fieldkit

面向现场支持人员的 DeepSeek Harness 插件。目标是一个简单的 EHA 命令工作台：选择已连接目标，填写官方 `eha-tool` 命令表单，执行并查看官方的原始输出。按钮操作不需要模型调用；右侧保留原生对话，用于解释已经得到的结果。

设备连接、协议和命令执行由公开 [`eha-sdk`](https://github.com/EHAPower/eha-sdk) 的 `eha-tool` 持有。插件通过 `eha-tool serve --direct-api` 直通既有 `/api` Workbench / ToolSession，不复制协议，也不在插件内增加授权、占用、范围、epoch、日志账本或以 unknown 为由的后续操作锁。命令结果无论成功、失败还是 unknown 都原样显示；unknown 是这一次执行的事实，不会改变下一次表单是否可执行。

> 新版已部署到 nzh-mbpm1 的官方 DSH 试用 profile。构建、34 项测试、独立审查及 USB 只读操作与对话联动已验证；具体范围见[迁移进度](docs/eha-migration-progress.md)。

## 兼容范围

| 组件 | 本版本目标 |
| --- | --- |
| DeepSeek Harness | `0.2.0-rc.2`，官方宿主不修改。 |
| eha-tool 服务 | `serve --direct-api` 提供既有 Workbench / ToolSession `/api`。 |
| 主机 | 原生 eha-tool 在目标主机运行；开发和软件验证在 devbox 中执行。 |
| 命令表单 | 只列出官方 Workbench 已提供的命令和参数，不接受 Shell 文本。 |
| 旧 WebUI | `eha-tool webui` 冻结、弃用但当前仍可用；本次不删除。 |

所用 eha-tool 必须来自包含 `serve --direct-api` 的 SDK 版本。版本、服务或认证不可用时，工作台显示原始错误；不会改用别的实现或重写为本地设备协议。

## 构建与安装

在本机开发时优先进入已有 devbox 容器，在项目目录执行：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm pack
```

在独立的 `fieldkit` profile 中安装生成的 `.tgz`：

```sh
dsh --version
dsh --profile fieldkit --from-default-profile web --help
dsh plugin --profile fieldkit add /absolute/path/to/ehapower-dsh-fieldkit-0.2.0.tgz
```

DSH 的 Host / Client、面板和 Remote 只使用发布包提供的接口；官方 DSH 源码、依赖和运行时不作修改。

## 服务设置

开发验证可在 devbox 中构建 eha-tool：

```sh
cargo build -p eha-tool --release --locked
```

目标主机必须使用匹配系统和架构的原生完整 eha-tool 发行目录；容器内的 Linux 构建产物不能直接用于 macOS 主机。启动 Harness：

```sh
dsh --profile fieldkit --no-open
```

工作台“服务设置”保存以下固定字段：

| 字段 | 用途 |
| --- | --- |
| eha-tool 绝对路径 | 官方可执行文件路径。 |
| 私有数据目录 | 服务发现记录和凭据目录。 |
| 服务端口 | 默认 `18080`，仅本机回环地址。 |
| 记录目录（可选） | 原样转交官方服务。 |
| ODrive Python 绝对路径（可选） | 原样转交官方服务。 |

点击“发现 / 附着服务”使用既有实例；未发现服务时点击“启动服务”。启动命令固定为 `eha-tool serve --direct-api` 和上述参数数组，服务设置不接受 Shell 文本或额外命令行片段。Bearer/token 只由插件后端读取并附在本机服务请求中，不能出现在浏览器、模型调用、报告或仓库。

服务生命周期仅处理进程启动、发现、附着和退出；它不是产品工作流。关闭页面或 DSH 卸载插件不代替任何 eha-tool 命令。

## 工作台流程

1. 连接设备，或点击“使用现有 USB / CAN”选用 eha-tool 中的会话。
2. 在命令表单选择官方命令，填写该命令的参数。
3. 点击执行；插件将固定命令和参数转给当前 ToolSession。
4. 在同一位置查看原始返回、错误或 unknown 结果，并可继续执行下一条命令。
5. 需要解释时在右侧提问，或使用 `/connect-check`、`/state-triage`、`/configuration-review` 阅读已取得的结果。

每个表单提交只执行用户当前填写的一个官方命令。插件不为它追加读回、授权、占用、停止或恢复命令；也不把历史 unknown 变成新的前置条件。

目标选择区初始展开；选定目标后折叠，顶部持续显示当前目标和直接 Stop，使命令与结果保持在首屏可见。

| 现象 | 下一步 |
| --- | --- |
| 未发现服务 | 核对 eha-tool 路径、端口和私有数据目录，再点击“启动服务”。 |
| 目标不存在或连接失败 | 选择另一个 Workbench 列出的目标，或先使用对应官方连接命令。 |
| 命令结果为 `unknown` | 查看本次官方原始输出；用户可继续选择并提交下一条命令。 |
| 离线配置检查提示缺字段 | 粘贴完整原始配置 JSON；详细 SDK 诊断可展开查看。 |

## 对话工具

| 工具 | 作用 |
| --- | --- |
| `fieldkit_context()` | 返回当前对话目标、内存中的最近一次原始命令结果 `lastResult` 和静态完整命令目录。 |
| `fieldkit_command({ command, bodyText, queryText })` | 执行一个固定的官方 direct-api 命令并返回原始 HTTP 结果。 |
| `fieldkit_check_configuration({ record })` | 对用户提供的完整配置记录执行官方离线检查，优先传原始 JSON 文本。 |

配置原文和官方 `native_json_text` 不经 JavaScript 数值转换再写回。设备输出是结果文本，不是插件可执行的指令。

## 旧 WebUI

`eha-tool webui` 已冻结、弃用，当前版本仍可运行。本仓不会为它新增功能或更新其专属实现，本次也不会删除它。未来删除时会在 SDK 的独立发布中处理；CLI、Shell、独立服务和历史数据不属于这个冻结范围。
