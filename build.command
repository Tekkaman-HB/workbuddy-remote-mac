#!/bin/zsh
# [INPUT]: 依赖 Xcode Command Line Tools、Node.js、内置 UI、Swift 源码和独立 wire.mjs。
# [OUTPUT]: 生成 dist/WorkBuddy Remote.app，可独立运行，不依赖本机 WorkBuddy。
# [POS]: 项目根目录的原生应用构建入口。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
cd "${0:A:h}"
app_dir="dist/WorkBuddy Remote.app"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" work/swift-module-cache
npm run build:ui
mkdir -p "$app_dir/Contents/Resources/UI/assets"
cp work/ui-build/app.js ui/index.html ui/*.css "$app_dir/Contents/Resources/UI/"
rm -f "$app_dir/Contents/Resources/UI/assets/mascot.png"
cp ui/assets/WorkBuddyRemote.icns "$app_dir/Contents/Resources/WorkBuddyRemote.icns"
cp ui/assets/brand-mark.svg "$app_dir/Contents/Resources/UI/assets/brand-mark.svg"
rm -f "$app_dir/Contents/Resources/icon.icns"
xcrun swiftc -target "$(uname -m)-apple-macosx13.0" -parse-as-library -module-cache-path work/swift-module-cache \
  -framework AppKit -framework WebKit MacApp/SessionBridge.swift MacApp/RemoteApp.swift \
  -o "$app_dir/Contents/MacOS/WorkBuddyRemote"
cp lib/wire.mjs "$app_dir/Contents/Resources/wire.mjs"
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.tekkman.workbuddyremote</string>
<key>CFBundleName</key><string>WorkBuddy Remote</string>
<key>CFBundleExecutable</key><string>WorkBuddyRemote</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>WorkBuddyRemote.icns</string>
<key>CFBundleVersion</key><string>20261113.6</string>
<key>CFBundleShortVersionString</key><string>0.2.4</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$app_dir"
print "已构建：${PWD}/$app_dir"
