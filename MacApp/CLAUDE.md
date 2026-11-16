# MacApp/
> L2 | 父级: ../CLAUDE.md

成员清单
SessionBridge.swift: 账号认证为 unknown/signedIn/signedOut，401/无账号清理身份，网络失败不冒充退出； 仅按官方绑定接入 markRead 会话已读回执； 自动化只读方法、WebKit 独立账号与固定官方 HTTPS 通道；状态检查/重连单飞，只读通道断开/发布瞬断或超时/502~504/凭证网络故障最多重试一次；账号/设备/凭证 HTTP 设 15 秒超时；写入不自动重发，模型仅展示字段，产物定位需原生专用开关。
RemoteApp.swift: 认证状态快照与登录结果事件； 顶部保留真实鼠标事件并验证左键/同窗口/时效/58pt 顶部边界后启动原生拖动，双击缩放；AppKit 窗口、独立登录、统一主题和受限桥；点击附件即校验归属并获取、隔离预览及缓存原文件。
ArtifactPreview.swift: 无原生桥和账号 Cookie 的临时 WebKit 右侧预览，HTML 沙箱与深色阅读适配、文本/PDF/图片展示、展开阅读和 NSSavePanel 原文件保存。
ArtifactDownload.swift: 无 Cookie 的临时 HTTPS 下载、禁止降级重定向和 100 MB 上限，不记录签名链接。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
