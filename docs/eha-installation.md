# Fieldkit 安装与首启

本指南用于未修改的官方DSH Web、Fieldkit `.tgz`与平台原生完整eha-tool发行目录。USB/CAN观察、原配置保存读回、限定电机试验、模型同目标缓存、390控制页、服务生命周期及数据保留已有代表证据；完整P5、实物其它模式/群组、维护恢复与发布周期仍未完成。当前状态见[迁移进度](eha-migration-progress.md)，操作编号见[用户旅程](eha-user-journey.md)。

## 版本与安装前置

| 组件 | 当前验证事实 |
| --- | --- |
| 官方DSH Web | `0.2.0-rc.2`，官方宿主与运行时未修改 |
| Fieldkit | 源码`64fac12`，611918 B /63 files实际包已安装main和fixture；同名`0.2.0`版本须同时记录源码与候选包 |
| eha-tool | 新候选`e845dd0`原生macOS arm64 release及test no-run编译成功，独立合成writer失败与记录/短时试验/历史/退出成功链实际UI已验；main保持`c95aa7d`原服务和reset unknown，未通过升级或重启清账 |
| 仓库与交付 | 父`aa05dff`及上述源码本地提交、未push；不是正式发布或已发布回退保证 |
| 官方Desktop | 未列为本次已验证交付，不以Web证据代替 |

先按官方DSH对应版本的安装说明安装宿主，让插件管理所需的Node与pnpm在启动环境中可用。缺少pnpm时修正启动环境PATH，不修改官方包。

eha-tool路径须指向与DSH运行主机系统/架构兼容的完整原生发行目录内的可执行文件，保留`runtime`与许可。devbox的Linux构建用于开发验证，不能用于macOS主机。发行作者按[SDK构建与打包说明](https://github.com/EHAPower/eha-sdk#readme)使用SDK `scripts/package_tool.py`；操作员使用完整发行包。标准CAN runtime不需要自行pip安装或建venv；ODrive解释器须另行配置，不能由CAN runtime可用性推定。

## 安装到独立profile

以下是占位路径，替换为本机候选包；独立profile保留原宿主配置。

```sh
dsh --version
dsh --profile fieldkit --from-default-profile web --help
dsh plugin --profile fieldkit add /absolute/path/to/ehapower-dsh-fieldkit-0.2.0.tgz
dsh --profile fieldkit --no-open
```

自定义profile本身是Web入口，启动命令不追加`web`。首次从官方Web模板建立profile后，不要再用模板初始化代替插件升级。

DSH profile与插件依赖由宿主管理，默认DSH home为`~/.dsh`，可由`DSH_HOME`选择。Fieldkit设置/数据属于运行主机当前用户，独立于profile；隔离验收还需独立`XDG_DATA_HOME`。仅换profile或DSH home不迁移Fieldkit数据，也不证明无模型凭据，DSH还可读取环境与`.env`。不要复制或公开凭据文件。

## 配置并启动服务

打开EHA工作台“服务设置”，填写并保存固定字段：

| 字段 | 填写内容 |
| --- | --- |
| eha-tool绝对路径 | 匹配平台的完整原生发行包可执行文件 |
| 私有数据目录`dataDir` | 当前用户拥有的私有绝对目录，权限`0700`，祖先目录满足安全检查 |
| 服务端口 | 未被其它进程占用的本机端口，默认`18080` |
| 记录目录（可选） | 单独保存SDK runs时填写；留空使用SDK默认目录 |
| ODrive Python绝对路径（可选） | SDK要求的原生解释器，含`odrive==0.5.1.post0`及USB依赖；留空由官方工具选择 |

设置不接受任意命令或附加参数。保存路径不证明程序可运行：不存在或不可执行文件已实际触发`start_failed`中文路径/执行权限/版本指导。ODrive需独立枚举、明确选择和只读核对。

先点击“发现 / 附着服务”，核对认证后的实例；文件或PID存在不代表就绪。没有服务且设置正确时再“启动服务”。启动不自动连接、启用心跳或恢复目标，旧档案的自动连接标记也不改变此边界。更换设置/实例后明确重新选择目标；已有未决结果时先保留原服务与账本，不靠升级清除未知。

服务发现/token文件为当前用户`0600`私有文件；token只由主机进程读取，不能粘UI、对话或报告。精确协议只引用配套SDK `crates/tool/service-api.md`。默认service-v2，版本/认证/连接失败拒绝操作，无自动fallback；integration是显式只读v1，legacy-cli是显式旧直连，均不是v2故障恢复办法。

## 人工按钮与已验证范围

模型提示可选择**Configure later**。无模型服务启动、USB连接、缓存、六步诊断与原文离线检查已实际取证；模型默认名称不表示已配置凭据。

1. 启动或明确附着服务，刷新候选，核对身份/连接代次后选择并连接目标。
2. 查看缓存与年龄；读取门允许时开始只读诊断，首次失败/身份变化停止后续步骤并保留部分证据。
3. 导入完整配置原文，交SDK校验；编辑/导出保留未改字段原文，不经JavaScript数值重建。
4. 维护/控制按既定SOP另行明确授权、范围和确认；本指南不提供新的设备动作命令。

USB与单节点CAN六步、ODrive修复后读取、原文静态校验/导出已有证据。原User保存并重启后逐字读回已证；随后真实reset仍是原编号unknown。新鲜六步与User/Startup一致不能清未知，后续factory/rehearsal/ROM链已停，main服务保持。

USB/CAN限定0.5 mm/s×2 s、max3 s电机trial、Stop观测及三文件记录导出已过。它们是同一物理EHA；模拟位移/压力与宽窗编码器变化不证明液压行程、力或机械安全。物理其它模式/群组须有正向SOP、第二独立板与现场条件。

模型官方工具卡已确认`fieldkit_snapshot{}`读取同一人工绑定缓存，缺能力或失败不补主动诊断。缺凭据、合成TRANSPORT/idle TIMEOUT时人工按钮仍可用；不将这些扩大为所有模型故障保证。390控制页Stop/详情/键盘已实际验证。

真实SDK合成writer审计BadFD拒绝初目标，partial三文件导出已审；新包旧queued/当前not_submitted卡没有失效trial Stop，独立固定Stop可用。明确请求结束记录仍保留BadFD、概要记录未活动，UI退出成功；无completion记录不能称完整。

## 生命周期、升级与卸载

关闭页面、DSH退出或卸载插件不新增设备Stop，也不kill独立eha-tool。普通持续控制、心跳、记录各自管理；有界试验由SDK按原期限自主收尾。实际窗口返回原会话、原号历史恢复、DSH Host退出后的合成trial截止已有证据，历史不是恢复授权或重放动作。

确需退出服务时，先核对实例/会话/心跳/试验/未决效果摘要，再明确确认“退出服务”。响应只表示受理，不能据此证明进程退出或设备停止；未知/超时不自动重试。原未知维护不得靠退出或重启服务清账。

升级保留完整旧SDK发行目录、DSH profile/插件依赖、Fieldkit设置/服务目录、档案、配置原文、报告与runs。通过官方Plugins安装指定候选，再核对版本、描述和能力；插件升级或改工具路径不替换正在运行的服务。当前main仅重启DSH、SDK c95及原未知保留；新e845验证使用独立实例。

旧自定义XDG owner与新版混跑不保证互斥；统一升级前明确退出旧通路owners。跨XDG新版互斥及同实例共享附着已取证，切profile/XDG不能作为并行打开同设备办法。

卸载使用官方Plugins **Uninstall**；重装**Add plugin**选择本地`.tgz`→**Install**→**Enable now**，再明确附着原服务。原生实际文件保留已取证：设置/历史保留、服务保持、三文件逐字一致，无自动范围/连接/心跳。CSV等待超时当时仍在读取，继续同一次请求后成功，未重发；不把等待工具超时记为产品失败。不要顺带删除数据、SDK或凭据。

当前c95及旧本地4bd离线configcheck、旧4bd隔离runs副本GET-only读取已过，不能称已发布回退、设备配置回滚或任意版本兼容。完整P5、正式R3/R4、最终独立双审及P6真实周期仍未完成。

## 出错后的下一步

| 现象 | 下一步 |
| --- | --- |
| 安装找不到pnpm | 修正官方DSH启动环境PATH，再用公开插件安装命令 |
| 路径保存后start_failed | 按中文指导核对原生可执行路径、执行权限、版本 |
| 版本/能力不符 | 使用配套原生候选，不以legacy直连绕过拒绝 |
| 端口占用/认证失败 | 核对现有实例、目录与权限，不覆盖运行中凭据 |
| 启动未知/绑定失效 | 发现/明确附着并核对实例或重新选择；不反复启动或重放请求 |
| 读取首错/传输错误 | 保留部分报告、原error与身份，停止后续读取，不自动重试/重连 |
| reset或Stop unknown | 保留原编号，按原回执核对；新鲜Idle/配置相同不清未知，不自动重发 |
| 记录权限/审计错误 | 保留BadFD或原error、partial范围；核对目录/空间/权限，未提交不等于机械Stop |
| ODrive依赖缺失 | 指向SDK要求的原生解释器，独立核对只读能力 |
| 模型不可用 | 使用人工按钮；保留同目标与权限，不让模型错误触发设备恢复动作 |

采集完整只证明此次读取与身份连续，不证明设备安全、机构停止或整个迁移完成。
