#!/usr/bin/env bash
# dsh-profile-backup.sh — 修改 ~/.dsh/profiles/<profile> 前先备份（tar.gz + sha256 校验）
#
# 用法：
#   scripts/dsh-profile-backup.sh web        # 备份 web profile
#   scripts/dsh-profile-backup.sh appilot    # 备份 appilot profile
#
# 产物：~/.dsh/appilot-backups/<时间戳>-<profile>.tar.gz + .sha256
set -euo pipefail

PROFILE="${1:?用法: dsh-profile-backup.sh <profile名>}"
SRC="$HOME/.dsh/profiles/$PROFILE"

if [ ! -d "$SRC" ]; then
  echo "⚠️  $SRC 不存在，跳过备份。"
  exit 0
fi

mkdir -p "$HOME/.dsh/appilot-backups"
TS="$(date +%Y%m%d-%H%M%S)"
DEST="$HOME/.dsh/appilot-backups/$TS-$PROFILE.tar.gz"

# node_modules 可再生成（package.json 记录依赖），排除避免符号链接在 tar 恢复后失效
tar -C "$HOME/.dsh/profiles" --exclude="$PROFILE/node_modules" -czf "$DEST" "$PROFILE"
echo "  (node_modules 已排除——恢复后需按 package.json 重新安装)" 
HASH="$(shasum -a 256 "$DEST" | awk '{print $1}')"
echo "$HASH" > "$DEST.sha256"

echo "✅ 已备份: $DEST"
echo "   sha256: $HASH"
