---
name: configuration-review
description: 对用户提供的完整配置记录执行官方 eha-tool 静态检查，并原样解释结果。
user-invocable: true
---

# 配置记录审查

用于检查操作者在工作台中明确提供的完整配置记录。

1. 将用户给出的原始 JSON 文本直接作为 `record` 调用 `fieldkit_check_configuration({ record })`；不要重排、重新序列化或从设备和文件补取内容。
2. 报告官方返回的有效性、错误、警告和原始诊断。未提供完整记录时，请用户补充原文。
3. 这是离线命令结果，不创建保存、复位、维护、清错或运动命令。

不要展示或请求 token、主机路径、站点配置或设备未公开资料。
