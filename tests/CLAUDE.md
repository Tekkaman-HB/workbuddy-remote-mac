# tests/
> L2 | 父级: ../CLAUDE.md

成员清单
preview-theme.test.mjs: 报告深色纸面/卡片、语义色保留、原样恢复及 ECharts 主题更新幂等回归。
artifacts.test.mjs: 真实 Markdown 的文件入口、代码块/外链排除、注入拒绝和同名文件精确匹配回归。
transcript.test.mjs: 执行过程/正文分层、中断正文保留、真实耗时与工具摘要回归。
catalog.test.mjs: 自定义模型去重、已发布 ID 对应、禁用状态和路径末级名称归一回归。
tasks.test.mjs: 自动化按 ID 聚合、普通同名会话保留、任务/空间/助理/归档分流及分钟/小时/日历天显示。
motion.test.mjs: 后台入场不创建透明动画、动效中断与重开、关闭立即退出交互及减少动态效果的生命周期回归。
ui.test.mjs: 顶部拖动/控件排除、聚合自动化卡片/展开保留/产物归属/打开执行会话及迟到历史隔离；主题同步、富文本净化、能力裁剪、模型/路径搜索和原有连接/发送/草稿集成流程。
protocol.test.mjs: Node test 验证只读白名单、匿名统计和禁用云任务。
wire.test.mjs: Web Crypto 与断线测试，验证篡改、129 片乱序大目录重组、分片上界、密钥范围和请求及时失败。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
