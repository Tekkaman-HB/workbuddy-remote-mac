#!/bin/zsh
# [INPUT]: 依赖 Python 3、Node.js 和当前用户的 WorkBuddy。
# [OUTPUT]: 生成私有凭证并执行只读会话列表验证。
# [POS]: 项目根目录的 macOS 启动入口。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
set -eu
cd "${0:A:h}"
private_dir="${TMPDIR%/}/workbuddy-remote-lab-${UID}"
python3 lib/bootstrap.py --private-dir "$private_dir"
node lib/channel.mjs "$private_dir" list
print '验证结束。私有凭证仅保存在当前用户临时目录。'
