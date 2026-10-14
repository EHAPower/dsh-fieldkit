# dsh-fieldkit 开发说明

## 范围

- 通过官方公开 eha-sdk 的 eha-tool 适配设备能力，不复制协议实现。
- 目标工作台只负责连接选择、固定命令表单、官方命令执行和原始反馈；Workbench / ToolSession 是唯一命令执行者。
- 不在插件中维护 grant、reservation、claim、scope、epoch、journal 或以 unknown 为依据的后续命令锁；unknown 只如实显示为本次命令结果。
- `eha-tool webui` 已冻结并弃用，现有命令仍可用；本仓不再为它新增功能或更新专属实现。
- 工具参数使用固定命令和参数数组，不经过 Shell 拼接。
- Bearer/token 只在插件后端与本机服务之间传输，不进入客户端、模型、报告或产品流程。

## 开发

- `src/` 放插件、SDK 适配和报告逻辑；`skills/` 放内置 SOP；`test/` 使用合成数据。
- 优先使用已有开发容器安装依赖和执行测试：`npm ci --ignore-scripts`、`npm test`。
- 使用 `npm pack` 生成安装包，保持 `package.json` 的发布文件列表精简。
- 文档与简单可逆配置修改不新增验证框架；代码变更运行与其相关的现有测试。
- 只提交当前任务相关内容，保留无关修改。
