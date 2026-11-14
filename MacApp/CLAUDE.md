# MacApp/
> L2 | 父级: ../CLAUDE.md

成员清单
SessionBridge.swift: 接入自动化 listRecords/getRecordDetail 只读方法；WebKit 独立账号、通道及请求前恢复，固定官方 HTTPS 接口；状态检查/重连共用单飞，只读请求 CHANNEL_CLOSED 最多重试一次，写入不自动重发；模型仅展示字段、不重发在途写入，产物定位仅接受原生专用开关。
RemoteApp.swift: 顶部保留真实鼠标事件并验证左键/同窗口/时效/58pt 顶部边界后启动原生拖动，双击缩放；AppKit 窗口、独立登录、统一主题和受限桥；验证产物归属、逐次确认分享、隔离预览并缓存原文件。
ArtifactPreview.swift: 无原生桥和账号 Cookie 的临时 WebKit 右侧预览，HTML 沙箱与深色阅读适配、文本/PDF/图片展示、展开阅读和 NSSavePanel 原文件保存。
ArtifactDownload.swift: 无 Cookie 的临时 HTTPS 下载、禁止降级重定向和 100 MB 上限，不记录签名链接。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
