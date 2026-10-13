# EHA 迁移实施进度

本页记录已完成的验证与尚未满足的门槛。阶段范围见[迁移计划](superpowers/plans/2026-10-13-eha-dsh-ui-migration.md)，分项编号见[用户旅程矩阵](eha-user-journey.md)。已闭代表子例不重复验证，阶段与最终交付未因此自动完成。旧候选失败、修复过程及原始证据保留在既有私有报告与 progress.md，本页只写当前状态。

| 阶段 | 当前已证事实 | 剩余门槛 |
| --- | --- | --- |
| P0 插件与合同 | 官方公开生成接口、插件自有构建、Remote与按钮已工作；宿主未修改 | 随最终候选核对计划能力、接口与旅程的对应结论 |
| P1 独立服务 | 生命周期/owner/保留及陈旧发现、dataDir权限拒绝恢复已取证 | 已闭代表例不重跑；随最终覆盖表核对交付结论 |
| P2 连接观察 | 活动scan准入、CAN CRUD/失败指导、gap恢复/暂停、ODrive受控timeout已审闭 | 重复USB、warning来源及两context权限三阶段映射已审闭；仅代表软件范围 |
| P3 配置维护 | 原文/数值代表拒绝、三源diff、原User保存读回及Factory只读差异已证 | 实物reset原号unknown未闭，factory/rehearsal/ROM链停止 |
| P4 控制试验 | 限定实物trial；合成同目标慢读Stop、群组trial/trial门及普通目标生命周期已审闭 | 单/组撤权release实际修复闭；物理其它模式/群组仍有门槛 |
| P5 完整交付 | 安装/长内容390代表、healthy/partial/保留/CLI已有证据 | 四项有限软件子义务已审闭；完整实物、正式审查与发布周期未齐 |
| P6 旧UI退役 | 删除与兼容准备已有文档，未执行删除 | P5验收后的真实退役候选周期及下一次明确破坏性发布 |

## 合同与所有权

- 插件通过官方eha-sdk/eha-tool提供能力，不复制设备协议。精确服务合同只引用SDK的 [`crates/tool/service-api.md`](../../eha-firmware/eha-sdk/crates/tool/service-api.md)。默认service-v2，integration显式只读v1、legacy-cli显式旧直连，无自动fallback。
- SDK保持唯一物理通路持有者、身份/代次/权限、控制调度及记录责任。原始配置文本不经浏览器JSON重建；候选校验调用SDK。token文件只由主机进程读取，不进入UI或模型。
- 普通持续控制、心跳、记录与有界试验分别管理。关闭页面、DSH退出或插件卸载不新增Stop或清理独立服务；有界试验按SDK原期限自主收尾。解除范围不等于撤权、Stop或断连。
- 受理、本地提交、回复、观测和机械效果分层记录。unknown保留原编号，不自动重发；新nonce、新鲜Idle或配置相同不能清除原未知。USB/CAN目前是同一物理EHA，模拟反馈不证明液压行程、力或机械安全。

## 当前候选与实际证据

官方DSH Web **0.2.0-rc.2**未修改。插件 **11e5f90 /615408 B /63 files**统一build、7项codec检查和pack成功，已同时安装main/fixture；SDK **153cd2c**原生release/test编译通过，并用隔离真实SDK合成实例完成最后有限UI取证。main只重启DSH并恢复原设置、明确附着原 **c95aa7d**服务；原reset编号仍unknown/unresolved、原transport_disconnected错误保留。最终main选择USB观察、CAN断开、无HB/record，未发设备动作。旧scope/permission失败保留在原报告，最终修复输入按独立audit分别关闭；本地源码无push。

以下为私有证据的逻辑入口；设备标识、原文配置、主机路径和凭据不公开。

| 代表事实 | 证据入口与结论边界 |
| --- | --- |
| USB/CAN/ODrive与跨通路交接 | `p5-real-usb-*`、`p5-real-can-*`、`p5-alias-fixed-*`；同SDK实例CAN grant→release+明确撤权→USB grant成功，未额外发目标/心跳/记录/Stop |
| 原配置保存与reset未知 | `main-save-original-readback-*`、`p5-app-reset-*`；原User保存读回匹配；reset原号仍unknown，重连后六步与User/Startup精确一致只计只读恢复 |
| 限定电机试验及记录 | USB/CAN均0.5 mm/s×2 s、max3 s completed/Stopobserved；USB6085 rows、CAN2384 rows，三文件实际导出。CAN首次CSV未落盘后明确人工重试成功；编码器宽窗变化不能唯一归因这2 s |
| 合成调度、群组和会话 | `p5-group-native-*`及独立audit；两成员prepared/初始目标/一次位置更新/到期和手动groupStop/释放、trial_active门恢复已闭；原群组未知保留与会话canonical合并另证，不计物理群组 |
| writer拒绝与partial文件 | `p5-native-recording-audit-*`及独立audit；真实BadFD审计阻止初目标，partial三文件可导出，无completion不能称完整；旧queued/当前拒绝卡均已实际修复，结束记录请求仍保留BadFD；限定audit已闭 |
| 最新候选成功链 | `p5-final-joined-*`；e845/64单台合成范围，记录→同目标观察/暂停绘图→0.3 s试验completed/Stopobserved→明确结束记录→历史三文件清单→UI退出/进程exit0。1397遥测条、15事件、记录dropped0；无重复下载，不计实物或完整P5 |
| 同目标慢读与持续目标 | `p5-same-read-stop-*`、`p5-continuous-native-*`及独立audit；同目标Stop先于迟到read、部分诊断停止；普通目标跨UI/Host生命周期无自动Stop/重放，人工原范围Stop一次。owner未决latch不自动恢复符合合同 |
| 服务准备与not_idle | `p5-service-readiness-evidence-audit`；陈旧descriptor不覆盖现服务、0755拒保存/0700恢复、fresh not_idle诊断禁用三子例闭；无target/Stop，无新增窄屏PASS |
| 下载busy Stop/短截止窗 | 旧B Stop16.445 ms闭；`p5-pressure-bounded-*`及audit补到同次下载前后仍active夹住3 s trial、duration Stop/观测和HB窗口，final8546 entries/end/drop0。旧截断/未发trial失败保留；不证明全局负载、每chunk时刻或整个下载期HB |
| 最后有限清理/记录/模型链 | `p5-cleanup-nomodel-record-evidence-review`及`p5-model-context-journey-review`：原单/组明确撤权后released；无模型真实SDK合成记录启动/停止/同run历史，completion282遥测/3事件/drop0；J09交叉权限三阶段两个context与可见UI一致。final62 entries/end/drop0、3pump全read，记录路由独立，不写模型执行设备动作或逐字下载PASS |
| 扫描/事件/配置与长内容 | `p5-scan-events-native-evidence-audit`、`p5-runtime-ui-evidence-audit`、`p5-model-warning-source-review`：active扫描拒绝/恢复真实worker、gap后新曲线断线、暂停返回年龄、CAN CRUD/指导、worker timeout、精确整数拒绝、三源diff及实际390代表控件闭；旧scope解除失败保留，新单/组正常撤权清理按最终audit闭 |
| 可用性、保留与CLI | `p5-narrow-grid-390-fixed*`、`p5-native-retention-*`及CLI记录；390控制/详情/键盘、原生真实文件卸载重装逐字保留已过；c95与旧本地4bd离线configcheck均exit0；旧4bd隔离副本276次GET-only读取三文件2855/16483/8718761 B逐字一致，精确TERM后无该进程，不计exit0或已发布rollback |

## 独立审查

R1原报告发现SDK读取租约泄漏、插件legacy codec与证据裁剪问题，修复已限定复审关闭；原报告保留。R2原冻结SDK/插件候选 **NOT PASS**不改写；后续身份侧Spec PASS/Quality Approve、调度四项delta Approve及插件修复增量均按各自输入关闭。增量Approve不计新的正式轮次。

审计入口为私有`p5-independent-software-closure-review.md`。**正式R3/R4尚未开展**，因为完整实物旅程前提尚未齐；最终候选至少两次独立无未解决P0/P1/P2审查仍未满足。本轮有限软件收尾与删除准备独立只读审已得Spec PASS / Quality Approve，新增P0/P1/P2为0；仅该范围，非正式轮次，不扩完整P5/实物/删除批准或无限矩阵。文档/构建/实现者复核不替代正式门槛。

## 有限剩余门槛

1. 保留main reset原号unknown，回执两项源码独立delta已Approve，新SDK原生验证已完成，现场未知仍保留；只按原编号核对结果，不重发或重启服务清账。未知未闭前不执行factory、rehearsal、更新入口或ROM恢复。
2. 四项有限软件差额已按最终audits关闭对应子例：cleanup、共享permission投影、J08补的无模型记录链、J09模型context三阶段。旧Host错误关联撤回，整个J08/P5不追认完成；有限软件收尾独立反方审已通过、无新增finding。已闭输入不重跑，不自动添加“其它组合”。
3. 保留当前可review界面；正式R3/R4及最终两次clean review仍需完整实物旅程等前提，不能因有限软件闭环直接宣告正式轮次。既有SOP与核验目标授权持续有效；未做的factory/restart、reset结果确认、更新入口与ROM→应用恢复仍须满足原unknown闭环、现场门禁与既定恢复路径。物理群组缺第二独立板；其它控制模式缺可用正向机械SOP/现场条件，均保持未验收，不以合成补齐。
4. P6等待真实退役候选周期及其后的明确破坏性发布，保留旧UI和必要service/v1/CLI/config/runs/许可边界；无正式发布、push或提前删除结论。
