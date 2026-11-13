# lib/
> L2 | 父级: ../CLAUDE.md

成员清单
bootstrap.py: Python 本地鉴权桥，通过已安装 SDK 读取设备并申请独立 web 通道凭证，不导出 WorkBuddy 登录令牌。
channel.mjs: Node.js 临时装载已安装 SDK，执行明确允许的只读远程命令，显式拒绝云端任务。
protocol.mjs: Node.js 命令白名单、结果归一和匿名统计。
wire.mjs: Web Crypto + WebSocket 独立协议，支持加密、验签、最多 1024 片/32 MiB 回包、64 MiB 总缓存边界和断线收敛，可被原生 App 复用。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
