#!/usr/bin/env bash
# dsh-profile-backup.sh — 修改 ~/.dsh/profile 之前先备份（可回滚）
#
# 用法：
#   scripts/dsh-profile-backup.sh web          # 备份 web profile
#   scripts/dsh-profile-backup.sh appilot      # 备份 appilot profile
#
# 备份到 ~/.dsh/appilot-backups/<时间戳>-<profile>/，原样复制。
set -euo pipefail

PROFILE="${1:?用法: dsh-profile-backup.sh <profile名>}"
SRC="$HOME/.dsh/profiles/$PROFILE"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$HOME/.dsh/appilot-backups/$STAMP-$PROFILE"

if [ ! -d "$SRC" ]; then
  echo "⚠️  $SRC 不存在，跳过。"
  exit 0
fi

mkdir -p "$HOME/.dsh/appilot-backups"
cp -R "$SRC" "$DEST"
echo "✅ 已备份 $SRC → $DEST"
