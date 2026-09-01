#!/usr/bin/env bash
# dsh-profile-restore.sh — 从备份恢复 profile（先校验 sha256，拒绝损坏的备份）
#
# 用法：
#   scripts/dsh-profile-restore.sh ~/.dsh/appilot-backups/<时间戳>-<profile>.tar.gz
#
# 动作：校验哈希 → 删除当前 profile 目录 → 从备份解压还原
set -euo pipefail

TARBALL="${1:?用法: dsh-profile-restore.sh <备份.tar.gz>}"

if [ ! -f "$TARBALL" ]; then
  echo "❌ 备份不存在: $TARBALL"
  exit 1
fi

# 1) 校验
EXPECT="$(cat "$TARBALL.sha256" 2>/dev/null || echo '')"
ACTUAL="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [ -z "$EXPECT" ]; then
  echo "⚠️  无 .sha256 清单，跳过校验（仍继续恢复）。"
elif [ "$EXPECT" != "$ACTUAL" ]; then
  echo "❌ sha256 校验失败（备份可能损坏），拒绝恢复。"
  exit 1
fi
echo "✅ sha256 校验通过: $ACTUAL"

# 2) 还原
PROFILE="$(basename "$TARBALL" | sed -E 's/^[0-9]{8}-[0-9]{6}-//; s/\.tar\.gz$//')"
echo "即将用备份恢复 profile「${PROFILE}」…"
rm -rf "$HOME/.dsh/profiles/$PROFILE"
tar -C "$HOME/.dsh/profiles" -xzf "$TARBALL"
echo "✅ 已恢复 $HOME/.dsh/profiles/$PROFILE"
