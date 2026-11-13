# ui/assets/
> L2 | 父级: ../CLAUDE.md

成员清单
WorkBuddyRemote.icns: 独立双屏与助理双眼图标，包含 16–1024 像素 macOS 表示，供 Dock/Finder 使用。
app-icon.png: 独立应用图标的 1024 像素透明 PNG 预览，由 tools/generate-icon.swift 生成。
brand-mark.svg: 与应用图标一致的双屏矢量标识，用于侧栏品牌区。

图标源代码位于 ../../tools/generate-icon.swift。重新生成时输出到 work/icon-build，再以 iconutil 打包 icns；生成中间 iconset 不进入资源目录。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
