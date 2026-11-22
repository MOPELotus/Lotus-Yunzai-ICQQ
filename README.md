# Lotus-Yunzai ICQQ 适配器映射

候选提供独立 TypeScript 消息、回执和旧配置映射。宿主统一接口确认后，可接到已获授权账号的 ICQQ 客户端生命周期。

- discoverLegacyAccounts 接收旧 config/ICQQ.yaml 解析后的对象，输出无凭据的检测结果。
- parseLegacyAccount 读取单条旧账号配置。凭据留在显式迁移事务中，调用方不得记录原字符串或解析结果。
- decodeEvent 归一好友、临时和群消息、申请及撤回。标识保持原字符串，群角色与宿主主人权限独立。
- encodeSegments 将宿主已准备的文本、提及、表情和媒体字节映射成 ICQQ 发送段。
- decodeSendReceipt 以有效消息 ID 确认送达，缺少回执时结果未知。

用项目 Bun 执行 bun test。消息映射与测试可离线运行。
