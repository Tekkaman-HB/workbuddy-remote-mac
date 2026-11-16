#!/bin/zsh
# [INPUT]: 依赖 git 与 gh CLI、npm 测试套件、build.command 的构建能力、work/release-notes-<版本>.md 发布说明；可选依赖钥匙串 Developer ID 证书与 notarytool 凭证。
# [OUTPUT]: 不产出代码；逐闸门自证后创建 git tag、GitHub Release 与 dist/WorkBuddyRemote-<版本>-universal-mac.zip asset。
# [POS]: 项目根目录的一键发布入口，串联 build.command 与 GitHub，独立于日常开发流程。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
cd "${0:A:h}"

app_dir="dist/WorkBuddy Remote.app"
# 版本的唯一权威源是 build.command 内嵌的 Info.plist；构建后再与产物核对
version="$(sed -n 's/.*CFBundleShortVersionString<\/key><string>\([0-9][0-9.]*\)<\/string>.*/\1/p' build.command | head -1)"
[[ -n "$version" ]] || { print "错误：无法从 build.command 解析 CFBundleShortVersionString。" >&2; exit 1; }
tag="v${version}"
zip_file="dist/WorkBuddyRemote-${version}-universal-mac.zip"
notes_file="work/release-notes-${version}.md"

# =============== 闸门 1：版本未曾发布 ===============
if [[ -n "$(git ls-remote --tags origin "refs/tags/${tag}")" ]]; then
  print "错误：${tag} 已存在于远端，请先在 build.command 提升版本号并提交。" >&2
  exit 1
fi

# =============== 闸门 2：工作区干净且与 origin/main 同步 ===============
if ! git diff --quiet || ! git diff --cached --quiet; then
  print "错误：工作区有未提交改动，发布必须从已提交状态构建。" >&2
  exit 1
fi
git fetch origin
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  print "错误：HEAD 与 origin/main 不一致，请先推送再发布。" >&2
  exit 1
fi

# =============== 闸门 3：发布说明就绪（人工把关，机器不代写） ===============
if [[ ! -f "$notes_file" ]]; then
  mkdir -p work
  cat > "$notes_file" <<TMPL
# WorkBuddy Remote ${version}

## 本版本更新

（请补充本版本更新内容，保存后重新运行 zsh release.command。）

## 下载与安装

- 资产：\`WorkBuddyRemote-${version}-universal-mac.zip\`（通用二进制，arm64 + x86_64）
- 系统要求：macOS 13+，目标 Mac 需运行 WorkBuddy 并开启「允许移动端连接此设备」

解压后拖入「应用程序」。App 为本机签名（未做 Developer ID 公证），首次打开若被 Gatekeeper 拦截，在终端执行（已公证的发布请删除本段）：

\`\`\`sh
xattr -cr "/Applications/WorkBuddy Remote.app"
\`\`\`

## 免责声明

本项目为个人学习研究用途的非官方独立客户端，与 WorkBuddy 官方无任何关联。使用者应遵守 WorkBuddy 服务条款，并对自己的账号与数据负责。
TMPL
  print "已生成发布说明草稿：${notes_file}" >&2
  print "请填写「本版本更新」后重新运行本脚本。" >&2
  exit 1
fi
if grep -q "请补充本版本更新内容" "$notes_file"; then
  print "错误：${notes_file} 仍是未填写的草稿。" >&2
  exit 1
fi

# =============== 闸门 4：自动测试 ===============
npm test

# =============== 构建与产物自证 ===============
zsh build.command
codesign --verify --deep --strict "$app_dir"
built_version="$(plutil -extract CFBundleShortVersionString raw "${app_dir}/Contents/Info.plist")"
[[ "$built_version" == "$version" ]] || { print "错误：build.command 声明 ${version}，产物为 ${built_version}。" >&2; exit 1; }
lipo_info="$(lipo -info "${app_dir}/Contents/MacOS/WorkBuddyRemote")"
[[ "$lipo_info" == *arm64* && "$lipo_info" == *x86_64* ]] || { print "错误：产物不是通用二进制：${lipo_info}" >&2; exit 1; }

# =============== 可选公证：证书与凭证齐备才启用，否则保持本机签名 ===============
notarized=0
identity="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
profile="$(security find-generic-password -s com.apple.gke.notary.tool 2>/dev/null | sed -n 's/^.*"acct"<blob>="\([^"]*\)".*/\1/p' | head -1)"
if [[ -n "$identity" && -n "$profile" ]]; then
  codesign --force --options runtime --timestamp --sign "$identity" "$app_dir"
  ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$zip_file"
  xcrun notarytool submit "$zip_file" --keychain-profile "$profile" --wait
  xcrun stapler staple "$app_dir"
  notarized=1
  print "已用 Developer ID 签名、公证并附加票据。"
else
  print "提示：未检测到 Developer ID 证书或公证凭证，保持本机签名（用户需按说明执行 xattr -cr）。"
fi

# =============== 打包与发布 ===============
ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$zip_file"
repo_slug="$(git remote get-url origin | sed 's#.*github.com[:/]##;s#\.git$##')"
gh release create "$tag" "$zip_file" --target main --title "WorkBuddy Remote ${version}" --notes-file "$notes_file"
print "已发布：https://github.com/${repo_slug}/releases/tag/${tag}"
