# EHA 迁移实施进度

本页记录已完成的验证与尚未满足的门槛。阶段范围见[迁移计划](superpowers/plans/2026-10-13-eha-dsh-ui-migration.md)，分项编号见[用户旅程矩阵](eha-user-journey.md)。已闭代表子例不重复验证，阶段与最终交付未因此自动完成。旧候选失败、修复过程及原始证据保留在既有私有报告与 progress.md，本页只写当前状态。

| 阶段 | 当前已证事实 | 剩余门槛 |
| --- | --- | --- |
| P0 插件与合同 | 官方公开生成接口、插件自有构建、Remote与按钮已工作；宿主未修改 | 随最终候选核对计划能力、接口与旅程的对应结论 |
| P1 独立服务 | 原生服务启动/附着/退出、唯一通路持有者、跨XDG互斥、数据保留有代表证据 | 无新增专属阻断；最终候选隔离附着串联已完成 |
| P2 连接观察 | USB/CAN六步诊断、ODrive读取、同目标模型缓存、原文报告与下载已取证 | 无新增专属阻断；最终候选同目标观察串联已完成 |
| P3 配置维护 | 原文校验/导出、原User保存重启与精确读回、Factory只读差异已取证 | 实物reset原号unknown未闭，后续factory/rehearsal/ROM链停止 |
| P4 控制试验 | USB/CAN限定速度试验、Stop观测、记录；合成群组/会话/截止/writer拒绝及下载busy Stop子例已取证 | 历史卡修复实际UI已闭；未执行的物理模式/群组受现场条件限制 |
| P5 完整交付 | 官方安装、390控制布局、模型失败后按钮、生命周期、partial导出、卸载重装保留已有证据 | 最终候选隔离成功链已完成；完整实板旅程与正式独立审查仍待，本地读取不替代发布回退周期 |
| P6 旧UI退役 | 删除与兼容准备已有文档，未执行删除 | P5验收后的真实退役候选周期及下一次明确破坏性发布 |

## 合同与所有权

- 插件通过官方eha-sdk/eha-tool提供能力，不复制设备协议。精确服务合同只引用SDK的 [`crates/tool/service-api.md`](../../eha-firmware/eha-sdk/crates/tool/service-api.md)。默认service-v2，integration显式只读v1、legacy-cli显式旧直连，无自动fallback。
- SDK保持唯一物理通路持有者、身份/代次/权限、控制调度及记录责任。原始配置文本不经浏览器JSON重建；候选校验调用SDK。token文件只由主机进程读取，不进入UI或模型。
- 普通持续控制、心跳、记录与有界试验分别管理。关闭页面、DSH退出或插件卸载不新增Stop或清理独立服务；有界试验按SDK原期限自主收尾。解除范围不等于撤权、Stop或断连。
- 受理、本地提交、回复、观测和机械效果分层记录。unknown保留原编号，不自动重发；新nonce、新鲜Idle或配置相同不能清除原未知。USB/CAN目前是同一物理EHA，模拟反馈不证明液压行程、力或机械安全。

## 当前候选与实际证据

官方DSH Web **0.2.0-rc.2**未修改。最新SDK **e845dd0**原生release与test no-run编译成功；插件 **64fac12**、父 **aa05dff**本地提交、无push，611918 B /63 files包已同时安装main与fixture。main仅重启DSH，原SDK **c95aa7d**服务及reset unknown账本保持。独立e845原生合成writer实际UI已复验：旧queued卡和当前not_submitted卡均无失效trial Stop，固定范围Stop仍可用，无trial_stale；明确请求结束记录并保留BadFD，概要记录未活动，UI退出成功。源码竞态复现不追认为现场reset未知的已证根因。

以下为私有证据的逻辑入口；设备标识、原文配置、主机路径和凭据不公开。

| 代表事实 | 证据入口与结论边界 |
| --- | --- |
| USB/CAN/ODrive与跨通路交接 | `p5-real-usb-*`、`p5-real-can-*`、`p5-alias-fixed-*`；同SDK实例CAN grant→release+明确撤权→USB grant成功，未额外发目标/心跳/记录/Stop |
| 原配置保存与reset未知 | `main-save-original-readback-*`、`p5-app-reset-*`；原User保存读回匹配；reset原号仍unknown，重连后六步与User/Startup精确一致只计只读恢复 |
| 限定电机试验及记录 | USB/CAN均0.5 mm/s×2 s、max3 s completed/Stopobserved；USB6085 rows、CAN2384 rows，三文件实际导出。CAN首次CSV未落盘后明确人工重试成功；编码器宽窗变化不能唯一归因这2 s |
| 合成调度、群组和会话 | `p5-native-long-trial-*`、`p5-native-group-*`、`p5-multisession-*`；期限/Host回归、逐成员未知保留、Busy时Stop可用、canonical合并已证，不计物理群组 |
| writer拒绝与partial文件 | `p5-native-recording-audit-*`及独立audit；真实BadFD审计阻止初目标，partial三文件可导出，无completion不能称完整；旧queued/当前拒绝卡均已实际修复，结束记录请求仍保留BadFD；限定audit已闭 |
| 最新候选成功链 | `p5-final-joined-*`；e845/64单台合成范围，记录→同目标观察/暂停绘图→0.3 s试验completed/Stopobserved→明确结束记录→历史三文件清单→UI退出/进程exit0。1397遥测条、15事件、记录dropped0；无重复下载，不计实物或完整P5 |
| 下载busy Stop | `p5-pressure-*`及独立audit；B下载busy时Stop回执0→16.445 ms子例闭。trace cap丢45024条，A期限不在完整trace，仅eventual completed/HB stop UI可见，不证明精确全程截止 |
| 可用性、保留与CLI | `p5-narrow-grid-390-fixed*`、`p5-native-retention-*`及CLI记录；390控制/详情/键盘、原生真实文件卸载重装逐字保留已过；c95与旧本地4bd离线configcheck均exit0；旧4bd隔离副本276次GET-only读取三文件2855/16483/8718761 B逐字一致，精确TERM后无该进程，不计exit0或已发布rollback |

## 独立审查

R1原报告发现SDK读取租约泄漏、插件legacy codec与证据裁剪问题，修复已限定复审关闭；原报告保留。R2原冻结SDK/插件候选 **NOT PASS**不改写；后续身份侧Spec PASS/Quality Approve、调度四项delta Approve及插件修复增量均按各自输入关闭。增量Approve不计新的正式轮次。

**R3/R4尚未开始**，最终候选至少两次独立无未解决P0/P1/P2审查尚未满足。文档收敛、构建或实现者复核均不替代这些审查。

## 有限剩余门槛

1. 保留main reset原号unknown，回执两项源码独立delta已Approve，新SDK原生验证已完成，现场未知仍保留；只按原编号核对结果，不重发或重启服务清账。未知未闭前不执行factory、rehearsal、更新入口或ROM恢复。
2. 最终冻结候选的隔离成功串联已完成，可review主界面保持运行；完整实板旅程受下列条件阻断。条件成立后补对应旅程，再开展R3/R4及最终两次独立clean review；不重复已闭子例。
3. 未做的factory/restart、reset结果确认、更新入口与ROM→应用恢复须在unknown闭环及既定恢复路径成立后执行。物理群组缺第二独立板；其它控制模式缺可用正向机械SOP/现场条件，均保持未验收，不以合成补齐。
4. P6等待真实退役候选周期及其后的明确破坏性发布，保留旧UI和必要service/v1/CLI/config/runs/许可边界；无正式发布、push或提前删除结论。
