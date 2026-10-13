# EHA 界面迁移覆盖表

本表将当前 `eha-tool webui`、CLI/Shell 的操作能力映射到 Fieldkit 面板和
`eha-tool.service.v2`。它不定义设备协议或复制 SDK 的配置校验；精确服务合同只引用
[`eha-tool service API`](../../eha-firmware/eha-sdk/crates/tool/service-api.md)。

| 现有能力 | 服务接口或执行核心 | Fieldkit 面板 | 最低验收门槛 | 阶段 |
| --- | --- | --- | --- | --- |
| 服务发现、版本协商、启动或附着 | `describe`、本机 owner-process；固定可执行文件与参数数组 | 设备服务设置 | token 不进浏览器；版本/能力不匹配明确拒绝；启动不连接设备 | P1 |
| USB 候选与当前目标 | `GET targets` | 连接与总览 | 无目标时不猜测；连接代次、UID、run nonce 清晰呈现 | P1/P2 |
| 观察绑定与解除 | `POST/DELETE bindings` | 连接与总览 | 解绑不关闭连接、Stop、停心跳或清除目标 | P1 |
| 缓存快照 | `GET bindings/{id}/snapshot` | 总览、遥测与诊断 | 显示来源时间、接收年龄、read permit 和未知效果；不发查询 | P1 |
| 状态、测量、诊断 | `POST bindings/{id}/reads` 的固定只读 action | 遥测与诊断 | 首次读取失败或身份变化停止；保留部分原始证据 | P1/P2 |
| Startup/User 配置读取 | `POST .../reads` 的 `config_startup`/`config_user` | 配置与维护 | 返回完整原文；显示值不回流输入 | P1/P3 |
| Factory 配置读取 | 后续只读 action；不得伪装为 P1 capability | 配置与维护 | 与 Startup/User 区别清楚；读取失败不以缓存替代 | P3 |
| USB 连接、重连、断连 | `connections`、`connections/{id}/reconnect`、`disconnect` | 连接与总览 | UID/代次变化拒绝旧上下文；连接不启心跳、不恢复目标 | P2 |
| 受管 CAN 档案与适配器 | profiles、adapters、connections | 连接与总览 | 以稳定适配器身份选唯一候选；档案锁不替代物理 owner lock | P2 |
| 高级 CAN、节点与受限扫描 | 受限 scans、共享 CAN owner | 连接与总览 | 不隐式全网扫描；试验/心跳/非 Idle 门禁有效；逐节点报告 | P2 |
| 遥测曲线与缺口 | 游标 events、snapshot cache | 遥测与诊断 | 250 ms 串行投影至多一个在途；暂停绘制不停止采集或记录 | P2 |
| ODrive USB 只读 | `odrive/devices`、`odrive/read` | 遥测与诊断 | 枚举、读取、解释器缺失和超时分别显示；不证明 H723 状态 | P2 |
| 记录开始、停止、列表与导出 | binding recording、recordings 与固定记录 ID | 记录 | 慢页面/下载不阻塞服务；断连保留部分记录；不接受任意路径 | P2/P4 |
| 本地完整配置检查、导入和导出 | `config/validate`、配置 schema | 配置与维护 | 原始十进制文本和重复字段规则交给 SDK；离线检查不访问设备 | P3 |
| 保存并重启、恢复出厂、应用复位、进入更新 | binding maintenance 固定动作 | 配置与维护 | 只显示受理/本地提交；断连、run nonce 或 HTTP 成功不当作保存/更新完成 | P3 |
| 心跳启停与一次检查 | binding heartbeat | 控制 | 停心跳不等于 Stop；页面关闭不改变心跳 | P4 |
| 持续 position/velocity/force/impedance 目标 | binding target、control reservation | 控制 | 保留原始十进制参数；到位、HTTP 超时和 UI 卸载不自动 Stop | P4 |
| 普通 Stop | binding stop 的独立高优先级路径 | 控制 | 只显式点击/调用才提交；拥塞、慢查询和占用不得挤占受理；本地提交不等于机械停止 | P4 |
| 单台有界试验和位置更新 | binding trials | 试验 | SDK 预检、时限、一次 Stop、后续新鲜遥测确认和未知结果保持原语义 | P4 |
| CAN 群组试验与群组心跳/Stop | groups 与 groups trials | 试验 | 固定成员集合，逐设备准备/提交/停止/未知结果；不声称原子成功 | P4 |
| 旧网页静态资产和 `/api/*` 路由 | P1 起由同一服务核心薄适配；P6 删除 | 无新面板 | 每项本表能力迁移或经用户明确取消后，才可进入删除发布 | P1/P6 |
| CLI 与 Shell | 默认直连或显式 `--via-service`，共享执行核心 | 不适用 | 直连先取得 owner lock；服务故障或版本不兼容不静默回落直连 | P1 |

P1 尚在实现和验收；它只开放上述表中标为 P1 的精确只读 capability。配置写入、控制、试验、记录开始和任何
服务端自动恢复都不能因面板已存在而提前启用。每次服务请求持续绑定服务实例、目标、连接代次与
UID/run nonce；实例重启或身份变化后，用户必须重新取得绑定。

P5 的完整替代验收要求操作员在未经修改的官方 DSH 中，仅凭 Fieldkit 插件和匹配版本的
eha-tool 完成表内所有仍支持的工作流；无模型凭据时按钮仍可工作。通过软件测试不代替 USB/CAN
实板、设备状态或机械安全证据。
