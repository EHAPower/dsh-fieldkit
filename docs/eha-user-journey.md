# EHA 插件用户旅程验收

本表用于迁移验收准备，不证明功能已实现或测试已通过。已执行结果按阶段记录；未执行项保持 **待验收**，阶段通过不等于最终全流程通过。范围与阶段以[迁移计划](superpowers/plans/2026-10-13-eha-dsh-ui-migration.md)为准；服务正式接口只引用配套 SDK 的 [`crates/tool/service-api.md`](../../eha-firmware/eha-sdk/crates/tool/service-api.md)，其编写、冻结及实现尚须对应阶段验收，本表不复制协议或定义新接口。

## 执行与证据约定

- **UI**：使用实际打包并安装的插件与未修改的官方 DSH，通过浏览器或桌面实际操作；注明配套原生 eha-tool 或合成服务。后端测试不能替代这一证据。
- **实物 UI**：只能在身份已核验的目标主机，使用兼容该平台的原生程序及既有 SOP 执行。USB、每种承诺支持的 CAN 接入、ODrive、单机及群组分别留证；缺设备、适配器或恢复条件时仍为待验收并注明阻塞，不能以合成 PASS 补齐。
- **合成 UI**：真实界面与服务配合合成传输或受控故障。记录注入点、错误原文及副作用次数；不得为了验收在实物运动中拔线、替换身份或制造未知危险。正常实物流程仍须另验。
- 实物写入或有界运动前记录目标、身份、原始配置、范围、速度/力限制、停止条件和恢复路径；首个必要门禁失败即停该设备动作链，未知副作用不自动重放。
- 每项证据记录宿主/插件/服务精确版本、平台、用例、时间、结果及必要截图/日志入口。动作证据分别记录服务受理、本地提交、回复、新鲜观测、设备执行与可核验的机械效果；只取得其中一层时如实保留，不推断其余层。
- 原始日志、设备身份、配置与凭据保存到私有位置；本表只填脱敏的证据索引。表中“待采集”是证据要求，不是已有产物。
- 后续填写实际结果时区分通过、失败、阻塞和未执行，并保留合成/实物类型；不重复验证未变化且已取得充分证据的输入。

## 安装、服务与模型

| 功能 | 操作步骤 | 预期提示 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| J01 首次安装（UI） | 在干净官方 DSH 安装实际插件包；打开 EHA 工作台与原生对话 | 插件可发现，版本与前置依赖清楚；无需旧 WebUI 或宿主补丁 | SDKc95aa7d原生release与test编译成功，插件e3f572c/父b1e4de6本地提交未push；610809 B包已装main/fixture。fixture另已装611486 B initial-reject提示修复候选，actual UI待复验；宿主未修改，完整交付仍待 | 官方DSH 0.2.0-rc.2；私有c95原生构建/安装入口；编译不等于旅程PASS |
| J02 服务路径与数据目录（UI） | 在服务设置选择原生 eha-tool、私有数据目录与 ODrive runtime；测试缺失/不可执行路径 | 给出具体路径错误与修复入口；不会误用 Linux 容器产物；凭据不出现在浏览器或对话 | 原生设置保存/重开、不存在路径start_failed已过；新隔离profile非可执行文本保存后启动明确start_failed，中文检查路径/执行权限/版本。已恢复原生路径并保存，未新服务/连接；其它权限/发现分支仍待 | 私有p5-service-path-missing-ui、service-non-executable-ui入口；token不进浏览器 |
| J03 启动服务（UI） | 无模型配置时在插件启动服务，等待就绪 | 区分启动中/就绪/失败；仅启动服务，不自动连接、心跳或恢复目标 | 新原生服务实际启动；连接、心跳、记录、试验均由人工明确操作。合成fixture后续900 s TTL自然退出，不能计UI shutdown通过或控制自动恢复 | 私有主服务启动与native-long-trial-final-events入口 |
| J04 附着已有服务（UI） | 通过插件连接已运行的服务，重新打开面板再附着 | 展示同一服务实例与已有会话；不创建第二持有者，不误清理外部服务 | P1 双 DSH 同服务附着通过；P2 无模型隔离 profile 显式附着主服务既有 USB，六步诊断及下载通过，没有另开 Client；跨环境互斥是独立子例 | 私有 P1 附着证据、p2-no-model-usb-diagnosis.json；跨 XDG 失败及修复复验见 J52 |
| J05 错误版本（合成 UI） | 使用不兼容宿主/插件/服务组合，尝试打开功能 | 显示实际版本、兼容限制与下一步；拒绝不兼容能力，不回落直连 | 旧原生工具不支持 serve 时明确拒绝；其他组合待验收 | 实际 tool_version_unsupported 提示及恢复到新版路径 |
| J06 端口占用与陈旧实例（合成 UI） | 占用配置端口或保留失效实例记录，再启动/附着 | 显示占用或实例失效原因；不会把错误进程认作就绪或覆盖有效服务 | P1 相同端口第二启动在就绪前拒绝；陈旧记录子例待验收 | 隔离数据目录使用占用端口，start_failed；原实例保持 |
| J07 凭据与目录权限错误（合成 UI） | 用错误/缺失凭据或不可访问私有目录连接服务 | 明确认证/权限失败及处理路径；凭据不泄漏，不绕过认证 | P1 错误凭据拒绝通过；恢复指引不足已列修复，权限子例待验收 | 隔离错误凭据副本，unauthorized；运行中真实凭据未修改 |
| J08 无模型全按钮旅程（实物 UI） | 无模型配置执行连接、观察、配置、维护、控制、试验与记录的已授权流程 | 人工按钮均独立可用；模型状态不成为设备能力门禁 | P1 隔离环境完成离线校验、服务启动、USB连接与诊断；P2 无模型隔离 profile 附着同一主服务 USB，六步诊断和下载通过；完整无模型设备旅程待验 | 私有 p2-no-model-usb-diagnosis.json；原生 CAN/ODrive 与合成分项另记，不将子例当全流程通过 |
| J09 有模型同目标（实物 UI） | 配置模型，提问并解释诊断；使用当前目标工具，再对照按钮结果 | 对话与按钮使用同一目标、权限和证据；解释不冒充新读取或执行证明 | 旧“仅缓存”却主动诊断的失败保留；官方工具卡已实际展开核对fieldkit_snapshot{}，输出同一USB人工绑定目标。关闭该缓存限定子例，完整模型旅程仍待 | 私有p5-model-cache-only-toolcard-expanded、toolcall-return-ui入口；工具调用与目标已核对 |
| J10 模型断网/失败（合成 UI） | 让模型断网、超时或额度失败；继续按钮操作并使用 Stop | 对话明确报错；人工流程继续，Stop 可发现且不被模型 busy 禁用 | 缺凭据子例已过；隔离官方profile通过本地合成provider实际触发TRANSPORT及idle TIMEOUT，busy期间和错误后人工overview均可用。配额、活动Stop与其它压力仍待，不以overview代替Stop | 私有p5-model-transport-buttons、model-timeout-button-busy/post-buttons-ui入口；合成provider不计真实外网故障 |
| J11 显式退出服务（UI；实物仅按 SOP） | 查看活动会话及未决影响后执行服务退出，再启动/附着 | 明确服务生命周期与设备影响；退出不标为设备已停止；重启不重放动作 | P1 只读显式退出/再启动通过；P3 修复包在官方 DSH 退出后服务设置/启动入口仍可用，旧入口消失问题关闭；不证明设备 Stop | 私有 P1 记录、p3-shutdown-settings-fixed.jpg；只读及服务生命周期子例 |
| J12 升级与额外宿主（UI） | 升级匹配工具/插件/宿主并重开；若承诺 Desktop，使用该官方发行独立验收 | 数据保留、版本重新协商；不把 Web 结果当作 Desktop 通过 | P1→P2 插件通过官方管理升级，宿主退出时旧服务保留，再显式退出/启动原生新服务；完整数据保留、宿主升级及 Desktop 仍待验 | 私有 P2 安装/原生启动记录；各用户数据、其它宿主与回退证据待采集 |

## 连接、诊断与观察

| 功能 | 操作步骤 | 预期提示 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| J13 无设备（UI） | 未接设备时进入连接页、枚举、尝试依赖目标的按钮 | 空状态与接入指引清楚；禁用原因可见，不显示旧设备为当前连接 | P1实际无模型DSH合成零目标场景显示空列表；旧绑定过期，解除后身份清空且读取禁用；最终界面指引待验 | 私有 p1-fixture-no-device.jpg；明确标注合成服务，不计实板 |
| J14 多候选与错误选择（实物 UI；歧义用合成 UI） | 枚举多个候选，按可信身份选目标；尝试错误 UID/同序列号歧义 | 明确候选与身份；错误/歧义拒绝且不随机挑选、不写入 | P1 合成多候选需明确选择；P2 固定合成候选自动 snapshot 身份错误立即使绑定过期并禁用读取/绘图，不继续轮询；实物错误选择与歧义子例待验 | 私有 p2-fixture-narrow-fixed.jpg 及失效入口记录；没有将合成身份错误计为实物 PASS |
| J15 USB 连接档案（实物 UI） | 新建/编辑/保存 USB 档案，显式连接目标；删除不用档案 | 档案与实时连接分开；身份核对清楚；保存档案不自动连接 | 既有原生 USB 新建/连接已过；新原生离线服务实际 UI 新建临时 USB 档案→编辑名称→删除，全程未连接。完整连接异常子例仍待 | 私有既有连接证据与 p5-native-profile-edited-ui / deleted-ui 入口；离线档案操作不计设备动作 |
| J16 CAN 档案与适配器（实物 UI） | 对每种承诺接入选择适配器、接口/通道和节点，保存档案后连接 | 适配器/通路/节点可辨认；无效参数与 runtime 缺失有修复提示 | P2 原生 UI 核对已有 CANable2 档案与当前适配器，显式按档案连接单节点成功；新建/编辑、其它承诺接入及错误分支待验 | 私有 P2 原生 CAN 档案/枚举/连接记录；各接入类型与恢复证据待采集 |
| J17 CAN 扫描及多节点（实物 UI；冲突用合成 UI） | 对明确通路/节点范围扫描，观察多个节点；控制/试验期间尝试扫描 | 显示扫描进度与限制；不隐式全网扫描；多节点身份独立、共用唯一通路持有者 | P2 原生 UI 明确只扫描一个节点取得 Identity，勾选后批量连接一成功/零失败，无自动重试；USB/CAN 是同一物理设备，未验证多物理节点或活动控制准入 | 私有 P2 原生扫描/单节点 batch 记录；多节点与活动控制子例待采集 |
| J18 断连、解绑与显式重连（实物 UI） | 解除观察、显式断连，再显式重连同一目标 | 三者含义清楚；解绑不关闭连接；重连不启动心跳、不恢复目标或维护动作 | 旧alias Busy失败保留；同一c95 SDK实例CAN grant→release+explicit revoke→USB grant实际成功，alias子例闭，未发target/HB/record/Stop。reset后USB明确重连并旧CAN断连，六步新鲜完整，但不清原reset unknown；其它异常组合仍待 | 私有alias-fixed-*、app-reset-readback-report/ui入口 |
| J19 身份/连接代次变化（合成 UI；正常重连用实物 UI） | 重建连接或注入 UID/运行身份变化，保留旧页面请求再提交 | 旧上下文被拒绝，要求明确重新选择/绑定；首次变化即停止诊断 | 合成代次变化立即失效、禁用读取已过；新版真实USB断连/重连正常流程已过，CAN新代次读取complete。其它旧请求/身份更换矩阵仍待 | 私有generation-changed、usb-reconnect-4bddee1-ui、real-can入口 |
| J20 缓存与主动诊断（实物 UI） | 查看缓存年龄，再主动执行状态、测量、诊断及配置查询 | 缓存/新读取来源明确；真实步骤与进度，不把报告完整解释为设备安全 | 现主DSH新包配原生fd636b6，实际USB六步读取complete；既有CAN/USB及独立读取证据保留，原模型User超时原因仍未闭。未执行新维护或运动 | 私有p5-main-usb-native-preflight-report / ui及既有诊断入口；完整读取不证明设备安全 |
| J21 查询准入限制（合成 UI） | 在心跳、试验、非 Idle 与未决效果状态尝试主动读取 | 显示允许/拒绝原因及缓存来源；调度门槛未通过时保持限制；读取成功不清除未知效果 | 待验收 | 待采集：各状态提示、准入/效果日志 |
| J22 首错即停与部分报告（合成 UI） | 分别令首项/中途读取失败或身份变化，再导出报告 | 保留已采集原文、错误与未完成项；不继续下一设备读取，不标完整成功 | 合成中途失败/部分导出已过；新增 status 首错仅身份取得，status失败、后四步未执行，按钮提示先读缓存；日志唯一 POST reads=409。其它故障点仍待 | 私有 p5-first-read-failure-stale-ui / requests 与既有 p2-fixture-partial 入口；不计设备故障注入 |
| J23 遥测质量、过期与缺口（合成 UI；正常流用实物 UI） | 注入异常质量、事件缺失/游标越界及陈旧数据；恢复新数据 | 质量、来源时间和缺口可见；断续数据不画成完整连续证据；恢复不伪补缺失段 | 合成 gap 提示已过；新增 stale=true 时三曲线均缺口、不补零，invalid 的 result0/quality0/stale=false 原文保留且曲线缺口。恢复新数据、完整游标异常及正常实物流仍待 | 私有 p5-first-read-failure-stale-ui、p5-invalid-quality-ui / requests 及既有 gap 入口 |
| J24 曲线暂停/恢复与慢页面（实物 UI；背压用合成 UI） | 暂停绘图再恢复，隐藏面板/减慢消费后返回 | 暂停只影响绘图；服务采集与记录继续；返回显示数据年龄及缺口，慢页面不堵塞服务 | P2 合成 UI 已操作暂停/恢复，固定候选失效后旧曲线明确为历史；未据此验证实物持续采集、记录联动或慢页面背压 | 私有 P2 合成 UI 操作/历史提示记录；实物时间线、隐藏/背压子例仍待采集 |
| J25 ODrive 独立读取（实物 UI） | 枚举 ODrive USB，选择设备并执行已有只读流程 | 与 H723/CAN 状态分开；显示正确目标和只读边界，无控制入口扩大 | 原Python libusb atexit SIGSEGV失败保留；1915459独立审/软件通过、原生构建后实际UI明确读取成功，Idle/qualified/calibrated/errors0。仅关闭当前退出故障修复读取子例，不保证第三方永不失败 | 私有p5-main-odrive-preflight-ui、odrive-python-crash、main-odrive-1915459-fixed-ui入口 |
| J26 ODrive runtime 与超时（合成 UI） | 分别设置解释器缺失、读取失败/超时，恢复配置 | 区分缺依赖、设备错误与超时；给出恢复入口，不伪造读取值 | 缺Python指导已过；原libusb退出崩溃保留，1915459修复后原生实际UI读取通过。超时、其它runtime错误及完整恢复矩阵仍待 | 私有ODrive崩溃及main-odrive-1915459-fixed-ui入口 |

## 配置与维护

| 功能 | 操作步骤 | 预期提示 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| J27 原文导入、编辑、差异及导出（UI；读取用实物 UI） | 导入配置原文，编辑一个字段，比较 Factory/Startup/User 与待提交差异，再导出 | 单位、范围、来源明确；未编辑原文字段与十进制输入保持原文，不以显示值重建配置 | 合成三视图、原生离线原文编辑/导出字节相等已过；实际Startup/User原文及Factory2088 B只读取得，与本轮User有两字段差异，未写入。其它编辑差异及完整三视图旅程仍待 | 私有maintenance-current-factory/ui、factory-differences、native-config-export入口；公开不复写配置 |
| J28 离线校验与精度（UI；原生离线校验） | 无设备校验合法/非法值、重复字段、非零下溢和大整数 | 调用 SDK 校验；错误定位可理解，浏览器转换不漏检，不要求设备连接 | 真实SDK离线UI已拒绝容量超限、节点128；新增重复id字段 invalid_config Decode(CustomError)，mm_per_count=1e-999 明确 invalid_config minimum0。候选清空、服务退出，无设备写入；完整数值矩阵仍待 | 私有 p5-native-offline-duplicate-ui、underflow-ui及既有node-bound/config-export入口；不计设备采用 |
| J29 维护授权与目标确认（实物 UI；拒绝用合成 UI） | 默认只读下尝试维护；明确开启指定目标权限并核对完整配置 | 写入门禁与理由可见；目标、权限、配置确认一致；对话不能绕过 | 合成身份/撤权拒绝已过；实物同一目标明确maintenance后仅保存原完整User配置，未扩大为其它维护动作。R2原候选NOT PASS保留 | 私有main-save-original-submitted/result/readback入口；其它维护仍待 |
| J30 保存并重启、重连读回（实物 UI） | 保存原始配置，按 SOP 提交完整配置并重启；显式重连同一 UID 读取实际采用配置与启动来源 | 分开显示提交与待核对；后续真实读回才能判断采用情况，单一新运行身份不足以证明保存 | 原16384 B User保存/重启后同UID新nonce、Startup1426 B/User16384 B逐字读回已过；原encoded ID重连404/候选卡失败保留，新版USB显式断连/重连及卡状态已复验通过，CAN六步原文也匹配备份。不重发维护，不扩为其它维护旅程 | 私有main-save-original-readback、usb-reconnect-4bddee1-ui、real-can入口 |
| J31 维护响应丢失/错误身份（合成 UI） | 丢失回复、变更实例/连接代次或目标，重复请求后恢复 UI | 结果未知或明确拒绝；不自动再写、不以重启成功代替结果；指出可执行的核对步骤 | 合成未知/身份/撤权证据保留；真实USB reset唯一normal1 unknown/unresolved，原号GET不变、未重发。明确重连/旧CAN断连后新鲜六步及原文一致仍不清unknown，后续factory/rehearsal/ROM链停止，服务保持。现场根因尚未证实 | 私有app-reset-unknown、readback-report/ui及原编号查询入口；不将新鲜Idle当维护确认 |
| J32 恢复出厂（实物 UI） | 在可恢复 SOP 范围保存必要配置，执行恢复出厂并重启，显式重连读回 | 提交/重启/实际读回分开；清楚说明配置影响与恢复路径 | 实际Factory只读取得与User两字段差异已留证，未执行恢复出厂/重启；仍待验收 | 私有maintenance-current-factory/factory-differences入口；维护及恢复读回证据待采集 |
| J33 应用复位（实物 UI） | 按 SOP 显式复位应用，观察断连并重连 | 不伪称保存配置；显示连接变化、新鲜状态和待核对结果，不重放旧动作 | 实际唯一reset_application返回unknown/unresolved，原号GET仍未知、未重发；USB重连、旧CAN断连后新鲜完整读取，User/Startup逐字同，不能证明原操作结果或清除未知。后续维护/恢复链停，主服务不重启清账本 | 私有p5-app-reset-before/unknown/readback-report/ui入口；不是reset结果PASS |
| J34 进入更新入口（实物 UI） | 先确认恢复路径，再按 SOP 进入更新入口并执行既定恢复 | 只描述进入入口的证据；不标为完整刷写或更新成功；恢复失败有下一步 | 既有只读预检门禁已过、reviewed Tcl已同步；因真实reset unknown停止后续factory/rehearsal/ROM链，未执行进入更新或恢复，仍待验收 | 私有maintenance/recovery-preflight、app-reset-unknown/readback入口；不清未知继续维护 |

## 控制、Stop 与试验

| 功能 | 操作步骤 | 预期提示 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| J35 控制授权与输入门禁（实物 UI；错误输入用合成 UI） | 选定可信目标、显式授权控制，核对范围/单位/限制；提交非法或越界输入 | 表单单位与禁用原因明确；校验/身份/占用失败不提交，按钮与工具规则相同 | 代码门与合成固定四目标已过；真实USB明确范围及权限后执行0.5 mm/s×2 s、max3 s限定速度试验。完整非法输入、其它模式/通路与群组仍待 | 私有p4-local-facts与p5-real-usb-velocity-trial-start/completed入口 |
| J36 心跳开始/一次/停止（实物 UI） | 按 SOP 分别使用心跳操作，并与普通 Stop 比较 | 心跳状态与控制状态分开；停止心跳不提示为停止控制，连接不隐式启动心跳 | 合成once/start/stop已过；真实USB/CAN限定trial结束后明确HB stop完成。完整三操作独立旅程仍待；HB stop不等于普通Stop | 私有real-usb-recording-events、real-can-heartbeat-record-stop-ui入口 |
| J37 位置/速度/力/阻抗目标（实物 UI） | 对 USB 与承诺支持 CAN，按各自 SOP 提交四类有界参数，并显式 Stop | 清楚展示目标、观测、数据年龄与结果层级；持续目标不因到达、超时或 UI 恢复而结束/重放 | 真实USB及CAN均以0.5 mm/s×2 s、max3 s限定速度trial completed/Stopobserved；编码器前后变化支持电机转动，但宽时间窗口不能唯一归因这2 s，sim feedback不计机械效果。其它模式及持续目标生命周期仍待 | 私有p5-real-usb-*、p5-real-can-velocity-trial/odrive-after入口 |
| J38 普通 Stop（实物 UI） | 从各相关面板执行显式 Stop，核对目标并观察后续状态 | 可发现且名称明确；区分受理、提交、观测与未知，不称未经证明的机械急停 | 实物USB/CAN限定trial Stopobserved、双会话canonical合并已过；新增真实SDK合成group Stop一成员unknown/unresolved、一成员known/unconfirmed。刷新及后续新鲜Idle仍保留原unknown，两节点各一次Stop、无targets，不计机械停止 | 私有native-group-stop-unknown/refreshed/later-idle/unknown-after-idle、final-events入口 |
| J39 Stop 与读取/模型 busy（合成 UI） | 延迟或永不回复普通读取，并令模型 busy；点击/键盘操作 Stop | Stop 不被普通 busy 禁用；不等完整读取超时，按合同调度边界尝试提交 | 真实SDK合成慢读中另一目标Stop早于回复2.580369 s；实物模型busy时键盘Enter Stop local/known、显示0 ms，当时trial已结束，不证明活动试验期间抢占或机械停止。同目标慢读等仍待 | 私有native-slow-read-timely-events、real-model-busy-stop-before/result入口 |
| J40 Stop 与资源压力（合成 UI） | 慢上传、大记录下载、满事件队列/操作账本时 Stop | Stop 仍可受理；心跳及试验截止继续处理；不只凭按钮可点击判定通过 | 下载busy B Stop子例独立审闭：POST→pump1.695 ms、完成16.445 ms，同期已捕获HB最大间隔29.949 ms。trace cap丢45024条，A期限不在完整trace；eventual completed/Stopobserved及显式HB stop可见，不证明精确全程压力截止 | 私有p5-pressure-*、p5-download-pressure-evidence-audit入口；保留trace覆盖边界 |
| J41 Stop 与跨对话占用（合成 UI） | 一个对话持有控制占用；有目标权限的人工操作者执行 Stop | 正确身份/代次下 Stop 不被另一对话占用挡住；错误目标仍拒绝 | 真实SDK healthy合成两身份、双session各有独立scope；B再占A目标得到普通控制Busy，A Stop可用。A Enter/B click共用canonical Stop，均local/known/unconfirmed、0 ms，唯一pump Stop提交；不是物理双板或压力 | 私有p5-multisession-*.txt、final-events.jsonl入口；两个bindings HTTP Stop不等于两个动作 |
| J42 Stop 结果未知（合成 UI） | 令 Stop 提交后缺失后续证据，送达迟到 Idle，再恢复查询 | 持续显示未知；本地提交/旧 Idle/普通读取不清除未知效果，不自动重发 | 合成stop_unknown复点/reload保留同canonical原编号unknown/unresolved，首次原scope POST返回同号/newSubmission=false，后续精确GET；真实SDK合成group后续新鲜Idle亦不清逐成员原unknown，无新Stop号 | 私有p5-stop-unknown-ui/reload/requests、p5-native-group-stop-evidence-audit入口；不把多次HTTP请求当作多次动作 |
| J43 单机有界试验（实物 UI） | 按 SOP 准备、开始、更新位置、显式停止及到期结束 | 阶段/进度真实；既有试验停止规则由服务执行；试验与记录关联明确 | USB/CAN 0.5 mm/s×2 s、max3 s试验completed/Stopobserved；仅限定电机子例，sim反馈不计机械PASS。合成45 s trial超过30 s仍可核对，35 s退出DSH后SDK到期完成；其它模式、更新/群组及完整引用生命周期仍待 | 私有real-can-velocity-trial、native-long-trial-*入口 |
| J44 群组有界试验（实物 UI） | 明确成员身份，建组、准备、开始、更新及群组停止/心跳，再释放群组 | 逐设备呈现准备、提交、停止与未知；释放不当作 Stop/断连，不承诺原子执行 | 固定DTO群组试验证据保留；新增真实SDK合成成功group仅执行一次group Stop，逐成员unknown/unresolved及known/unconfirmed，未发target/trial/HB/record。实物群组与截止/完整释放仍待 | 私有p4-group-partial与p5-native-group-stop-*入口；不以group Stop替代群组试验 |
| J45 群组占用与部分失败（合成 UI） | 成员已被占用、准备/提交/停止中单台失败，或停止结果未知 | 不抢占成员；指出失败/成功/未知的具体成员和下一步，不显示整组成功 | 旧group Busy误报成功/Stop禁用失败保留；610809 B新包仅fixture安装，实际A占一成员时B两成员ordinary Busy但Stop可用，一次点击两原bindings各1Stop、两节点各1pump/local，无target。late-reserve guard已修/独立Approve/针对验证，不复活已Stop scope；独立group部分未知/新鲜Idle不清未知子例亦已审闭 | 私有native-group-busy-fixed-before-stop/stop-ui/events、native-group-stop-evidence-audit入口；均合成，不计机械PASS |
| J46 通路中断与试验截止（合成 UI） | 在既定注入环境中断通路，关闭 UI 或重启 DSH，等待试验期限 | 普通控制生命周期不被新增自动 Stop；有界试验保留原停止规则，未知结果如实保留 | 真实SDK合成关窗口/TERM退出DSH后自主截止已过；新版45 s trial超过30 s仍可GET，35 s实际TERM后SDK到期Stopobserved/completed。首次未TERM注入失败保留，通路中断/资源压力仍待 | 私有native-long-trial-hostless-state/final-events、既有window-closed入口 |

## 记录、并发与生命周期

| 功能 | 操作步骤 | 预期提示 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| J47 记录开始/结束（实物 UI） | 显式开始记录，暂停曲线、切面板，再显式结束 | 记录状态独立于绘图/观察；目标、时间范围与完整性可见 | USB及CAN真实限定trial显式HB stop/record stop、三文件浏览器下载均完成；CAN2384rows/19events/dropped0。最终e845/64合成成功链在连接/观察切页和暂停绘图后仍记录活动，明确结束后生成完整标记；仅此绘图独立子例 | 私有real-usb-recording-*、real-can-recording-*及can-evidence-audit入口 |
| J48 历史记录与导出（UI） | 列举历史，打开旧/新/部分记录，按记录 ID 导出 | 记录可读取；完整/部分状态与来源明确，不接受任意服务路径 | USB/CAN真实记录三文件实际导出；CAN首次CSV未落盘失败保留，人工重试成功7,927,859 B/2384rows、19events/dropped0。partial记录可导出；旧run在卸装重装及隔离旧本地候选读取后仍逐字相等，均限定相应文件，不推成发布回退 | 私有real-usb/real-can-recording-*、native-recording-audit-*、native-retention-*、cli-rollback-summary入口 |
| J49 写盘与导出失败（合成 UI） | 注入记录目录写盘失败、导出权限错误/下载失败后恢复 | 真实错误与数据缺失范围可见；不把下载启动当作落盘完成；保留已有可读数据 | native真实BadFD审计拒绝初目标，partial三文件导出已独立审闭；旧trial_stale与queued历史失效Stop缺陷保留。e845/64fac12包611918 B实际UI显示not_submitted/原BadFD与下一步，当前及旧queued卡无失效trial Stop，固定范围Stop可用；未发target | 私有p5-native-audit-history-fixed-before/result/cleanup、events及原提示修复审查入口；仅该写盘失败恢复链 |
| J50 试验联动与断连记录（实物 UI；故障用合成 UI） | 走既有试验记录联动；合成断连/服务退出后重新打开记录 | 试验与记录一一可关联；部分证据保留，不把缺尾记录标完整 | USB/CAN完整记录子例保留；native BadFD拒绝初目标、partial三文件导出已审闭，缺completion不称完整。e845/64fac12实际UI已闭初始未提交及旧queued历史卡提示，明确请求结束记录仍BadFD/not_submitted，概要记录未活动，UI退出隔离服务exit0 | 私有real-usb/real-can-recording-*、native-recording-audit-*、native-audit-history-fixed-*入口 |
| J51 多标签页与多对话（UI；冲突用合成 UI） | 同时观察同一目标，切换目标，两个对话尝试控制 | 观察可共享，目标/权限路由正确，写入冲突明确；不共享错会话身份 | 真实SDK合成两UID双session各自独立scope；B再占A同目标明确Busy，A Stop仍可用；两页操作同canonical Stop只发生一次pump提交。仅关闭独立范围/同目标争用/合并子例，完整多会话竞态仍待 | 私有p5-multisession-*.txt/final-events入口；合成两身份不计两块实物 |
| J52 CLI/双服务/旧入口争用（实物 UI；异常用合成 UI） | 服务持有通路时尝试 CLI 直连、第二服务及兼容旧入口；再显式选 CLI 共享服务 | 同一通路只有一个持有者；冲突明确；共享服务失败不回落直连；不同节点不绕过占用 | 旧跨 XDG CAN 双服务曾真实失败；原生 9fb7f27 复验第二服务明确 owner_busy、主服务连接及缓存可读，第二服务由 UI 退出，此子例 PASS。旧 XDG owner 混跑不保证互斥，其它组合仍分别待验 | 私有 p2-cross-xdg-can-owner-busy-fixed.jpg；既有 USB / CAN CLI 子例证据保留，不宣称所有组合 PASS |
| J53 重复点击与去重（合成 UI） | 快速重复提交，同请求再次发送及同编号不同参数；注入账本容量/保留期边界 | 不重复副作用；参数冲突与容量限制明确；未决结果不因淘汰变可重做，Stop 仍可用 | 长trial过30 s、Host回归原ID核对已过；双合成session两个bindings HTTP Stop共用canonical编号，唯一pump/local Stop action，两UIlocal/known/unconfirmed。容量/参数冲突/其它去重仍待 | 私有native-long-trial-*、multisession-final-events及既有unknown恢复入口 |
| J54 请求超时、取消及迟到回复（合成 UI） | 让请求超时、取消等待、送达迟到/乱序回复后重新打开结果 | 取消等待不称撤回已提交字节；未知结果不自动重试，迟到回复不归给新请求/目标 | 新包合成：同服务Host重启保留原unknown号/完整scope；未送达回复中断后，从持久索引恢复原号pending，人工精确GET才显示本地提交/known，匿名pending保留不猜配。首次错过延迟窗口不计PASS；乱序/取消等仍待 | 私有 p5-recovery-new-host-ui、delayed-reply injection/interrupted/recovered-pending/recovered 入口 |
| J55 服务崩溃/重启（合成 UI） | 在未提交/已提交/未决各阶段重启服务，再附着并尝试旧请求 | 新实例使旧上下文失效；明确已有证据与未知范围，不恢复目标、不重放写入 | 旧Trial Stop失效与无服务历史查询禁用已过；最终e845/64切换新隔离实例并刷新候选后，旧范围明确expired、目标/HB/Stop禁用，旧unknown保留，新范围须明确重建。不是所有崩溃阶段或物理重启验收 | 私有p5-window-reopen-returned-ui、stale-original-scope、p5-final-joined-before-ui及限定复审入口 |
| J56 面板切换与刷新（实物 UI） | 观察/记录期间切面板、刷新再打开；按 SOP 核对持续控制 | 服务生命周期独立；不重连、不新 Stop、不重复提交；恢复提示显示真实数据年龄 | P1只读reload保留绑定；合成unknown reload保留原号且未重放目标。最新64fac12主Host重新打开后保持同一c95服务和原reset未知，USB既有连接保持、HB/record关闭；最新合成成功链切页/暂停绘图保持记录。不扩为活动持续控制的全部生命周期 | 私有P1 reload、p4-unknown-reload-ui/requests、p5-initial-history-main-restored-ui入口 |
| J57 窗口关闭、DSH 退出及重开（实物 UI） | 在已授权生命周期范围关闭窗口、退出 DSH、重新打开并附着 | 服务保持既定生命周期；不把关闭当 Stop；不自动恢复目标或移交未决控制权 | 窗口返回、合成长trial退出DSH后按SDK原期限结束并可核对已过；healthy及最新writer隔离服务由UI明确shutdown/exit0。主Host更新重启后同c95服务与原reset未知保留。旧TTL退出不改记UI shutdown；不计物理活动控制全程 | 私有native-long-trial-*、multisession-final-events、native-audit-history-fixed-cleanup、initial-history-main-restored-ui入口 |
| J58 插件卸载/重装（UI；活动设备仅按 SOP） | 卸载插件，确认宿主正常；重新安装并附着原服务、查看数据 | 外部服务不被清理；用户数据可恢复，既定动作不重放，宿主仍可用 | 官方Plugins卸载→Add plugin本地tgz→Enable now→明确附着同一原生4bd服务已过；设置/历史与实际文件保留，旧合成传输run15events/2719rows/dropped0，三浏览器下载2855/16483/8718761 B逐字等于前次。新范围空、无连接/HB/自动动作；UI shutdown后精确ps无进程，不声称exit0。仅该真实文件保留子例闭 | 私有p5-native-retention-*入口；CSV同一次读取继续等待完成，未重发，不计产品失败 |
| J59 独立 CLI 与数据回退（UI/CLI） | 不启动 DSH 运行既有 CLI；按迁移说明回退旧发行包并查看数据 | CLI 独立可用；资料/历史可读；回退不自动连接设备或重放操作 | 原生c95与旧本地4bd CLI离线configcheck均exit0，既有真实CLI owner_busy/显式共享证据复用。隔离4bd服务仅读旧run副本，276个GET、metadata/events/CSV为2855/16483/8718761 B且逐字相等；无连接/写控请求。仅本地候选兼容，不是已发布rollback | 私有p5-cli-rollback-versions-help、summary/readback/service及p5-cli-rollback-acceptance入口；隔离服务精确TERM后已退出，不声称exit0 |

## 操作员可用性与最终旅程

| 功能 | 操作步骤 | 预期提示 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- |
| J60 可发现性、单位与禁用原因（UI） | 对上述各面板找到按钮；检查目标/单位/范围、禁用、等待、进度与失败下一步 | 名称清楚，理由可见，进度有事实依据；提交、回复、完成、未知不混用 | 按钮/群组Busy/390布局及c95同实例alias交接已闭。e845/64fac12实际writer拒绝UI显示not_submitted、原BadFD和恢复指引，无trial_stale；同原试验queued历史卡也无失效Stop，固定范围Stop保持可用。真实reset仍unknown，新鲜读回不清未知 | 私有alias-fixed-*、native-audit-history-fixed-*、app-reset-*及提示修复审查入口 |
| J61 焦点与键盘（UI） | 用键盘走表单、导入/导出、确认/错误恢复；模型或读取 busy 时键盘访问 Stop | 焦点可见、顺序可理解；打开/关闭提示后焦点合理；Stop 可到达且不会误触其它动作 | 既有键盘Stop子例保留；真实390页Tab使启用到位条件可见，Enter展开完整identity details、ShiftTab返回Stop，无设备动作。完整其它表单/焦点恢复、活动试验busy仍待 | 私有p5-narrow-grid-390-fixed/details-keyboard入口 |
| J62 窄屏、滚动与长文本（UI） | 缩窄窗口，检查每面板、长配置/错误/诊断/对话与群组列表，滚动到操作入口 | 内容可读、按钮可达；身份、单位、未知/失败与 Stop 不被遮挡，长文本可查看/复制 | 旧390布局/Stop裁切失败保留；72817ed两CSS新包实际390控制页PASS，workbench302/scroll297/bar297，Stop left226/right360/top25/h44；详情与键盘可达。其它面板/群组/长文窄屏仍待 | 私有p5-narrow-grid-390-fixed-geometry/.jpg、details-keyboard入口；实际尺寸已核 |
| J63 退役候选完整旅程（实物 UI） | DSH 为默认入口，从安装/服务到 USB/CAN、ODrive、配置维护、单机/群组、记录和退出完整执行 | 日常操作无需终端或旧 WebUI；全部承诺能力有对应真实证据，模型两种流程成立 | 最新e845/64隔离成功串联已完成：明确附着、can1范围、记录、观察/暂停绘图、0.3 s合成trial completed/Stopobserved、结束记录、历史三文件清单、UI退出/exit0。复用既有安装/下载/CLI证据；完整实板旅程因reset未知、其它物理模式/第二板未通过 | 私有p5-final-joined-*；记录15events/1397telemetry/dropped0，不计机械或完整退役候选PASS |
| J64 删除旧页面后完整旅程（实物 UI） | 真实 P6 门槛成立并删除旧页面后，用最终包再次完成完整旅程及独立 CLI | 无旧页面/路由补救依赖；安装、合同、记录与实际设备工作流仍可用 | 待验收 | 待采集：删除发布版本、包内入口清单、最终旅程与 CLI 证据 |

## 真实外部门槛与交付门禁

以下仍为待满足，不能由合成故障测试、可控测试时钟、本地日期推进或本地提交替代：

| 门槛 | 要完成的事实 | 实际结果 | 必要证据 |
| --- | --- | --- | --- |
| R01 退役候选发布周期 | P5 已验收的候选将 DSH 设为默认入口，经历计划要求的真实退役候选周期；旧 UI 不能成为缺失能力永久入口 | 待验收 | 待采集：真实候选版本、周期起止/发布记录、操作员验收与问题处置 |
| R02 下一次明确破坏性发布 | R01 完成后，等待并完成下一次明确破坏性发布，满足 P6 全部删除条件后才删除旧页面/专属依赖；无自动 push 或正式 release 授权 | 待验收 | 待采集：真实发布决定/版本与说明、P6 删除门槛逐项证据 |
| R03 兼容与数据保留 | 已发布客户端的只读兼容边界单独处理；旧命令迁移提示周期明确，资料、历史与回退可读取 | 待验收 | 待采集：兼容策略/实际消费者验证、迁移说明、J48/J59 |
| R04 独立对抗审查 | 至少四轮实质独立审查，覆盖职责/合同、写控门禁、完整 UI 实物旅程、最终删除候选；最终候选至少两次独立审查无未解决 P0/P1/P2 | R2 原固定 SDK/插件候选 NOT PASS 保留；SDK 身份侧 PASS/Approve、四项调度 delta 全 Approve、插件后续 source delta 批准，新生成包已收敛。R3/R4 与最终两次无阻断审查未完成 | 四份本轮审查及新生成包逻辑入口；不同输入分别记录，不把源码/包收敛当作实际交付或发布周期通过 |
| R05 最终交付与可 review 界面 | P0–P6、实物/UI、审查、文档/包/迁移说明/任务提交齐全；提供已启动可访问的最终插件界面和启动/停止说明 | 待验收 | 待采集：阶段表、仓库提交/状态、版本/通路范围、私有证据入口和访问说明 |

退役周期长度与具体破坏性发布由实际发布安排确定，本表不擅自指定或缩短。R01/R02 未成立时只能完成迁移与删除准备，保留旧界面及必要兼容能力；不能删除或宣称迁移 goal 已完成。本表编写不是独立审查轮次。
