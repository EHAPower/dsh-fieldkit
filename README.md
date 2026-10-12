# @ehapower/dsh-fieldkit

面向现场支持人员的 DeepSeek Harness 插件：用**公开** [`eha-sdk`](https://github.com/EHAPower/eha-sdk) 的官方 `eha-tool` 做 USB 候选发现、单台控制器的只读诊断，以及离线配置记录检查。本仓不包含固件、设备协议副本、设备控制、维护或运动入口。

它适用于 DeepSeek Harness 的图形界面工作流。三个随附 SOP 会要求操作者明确选择设备，并把原始证据与现场判断分开报告。

## 安装

从发布源码构建插件包：

```sh
npm ci --ignore-scripts && npm test && npm pack
```

在 DeepSeek Harness 的 `fieldkit` profile 中安装刚生成的 `.tgz`（替换为本机上的绝对路径）：

```sh
dsh --profile fieldkit --from-default-profile web --help
dsh plugin --profile fieldkit add /absolute/path/to/ehapower-dsh-fieldkit-0.2.0.tgz
```

本包提供专用 `fieldkit` Agent preset，关闭此 profile 中的通用编程 preset，不加载工作区指令、文件扫描或 Shell 工具。建议用于独立 profile。

先从公开 SDK 的最新 `main` 构建官方工具。首次克隆时：

```sh
git clone https://github.com/EHAPower/eha-sdk.git
cd eha-sdk
git fetch origin
git checkout main
git pull --ff-only
cargo build -p eha-tool --release --locked
```

已有 SDK 克隆（包括当前处于 detached HEAD 的克隆）时，进入该目录后运行：

```sh
git fetch origin
git checkout main
git pull --ff-only
cargo build -p eha-tool --release --locked
```

当前只支持 Harness `0.2.0-rc.2`。部署时若 `@deepseek-ai/dsh@latest` 已升级到其他版本，需要先发布匹配该版本的适配更新；不要跳过 peer 兼容检查。

然后在 Harness 的 Plugins / Settings 界面打开本地 `fieldkit` 配置行，填写：

| 字段 | 值 |
| --- | --- |
| `toolPath` | 本机官方 `eha-tool` 可执行文件的绝对路径 |
| `reportsDir` | 本机用于保存诊断报告的绝对目录 |

私有凭据和站点配置只保存在仓库外的本地 Harness 配置中，不要提交到本仓。完成后从图形界面启动 profile，或在终端启动 Harness：

```sh
dsh --profile fieldkit --no-open
```

## 可用工具

| 工具 | 作用 | 边界 |
| --- | --- | --- |
| `fieldkit_devices` | 列出 USB 候选 | 候选不是连接、身份核对或健康结论。必须由操作者选择完整序列号。 |
| `fieldkit_diagnose_usb({ serial })` | 对指定 USB 序列号按固定次序读取 `inspect`、`status`、`measurements`、`diagnostics`、Startup 和 user configuration | 只读；返回摘要以及保存的 Markdown / JSON 证据路径。 |
| `fieldkit_check_configuration({ record })` | 通过公开 `eha-tool` 对完整配置记录做静态检查 | 不访问设备，不写入设备。 |

插件 v1 每次只面对一台由操作者明确选择的 USB 设备，绝不自动选取列表中的第一台。诊断是离散快照，不是原子快照或连续监控；只有 UID 与 `run_nonce` 一致的结果才能作为同一运行实例的关联证据。它不暴露运动、停止、复位、保存、清错或其他维护命令。官方 `eha-tool` 另有动作能力，但本插件不调用这些能力。

一次检查“有效”只表示该次读取或静态检查得到的结果满足其自身条件；“不完整”表示缺少所需证据。两者都不能推出整机、机构或现场处于全局安全状态。

## 图形界面中的使用方式

在 Harness 对话框输入 `/connect-check`、`/state-triage` 或 `/configuration-review`，按提示选择或提供对象。设备标识与快照会用于当前 Harness 对话和所配置的模型服务；请遵循现场的数据使用要求。不要将真实设备序列号、主机路径、凭据或现场报告发布到公开仓库、Issue 或公开聊天。报告保存在本机配置的目录。

本仓公开文档只依赖 DeepSeek Harness 与 [`eha-sdk`](https://github.com/EHAPower/eha-sdk) 的公开接口与说明。
