#!/usr/bin/env bash
# dsh-undo-appilot.sh — 撤销 @appilot 对某 profile 的改动（先备份现状，再从最近的备份恢复）
#
# 用法：
#   scripts/dsh-undo-appilot.sh web        # 撤销 web profile 的 appilot 安装
#   scripts/dsh-undo-appilot.sh appilot    # 撤销 appilot profile
#
# 优先级：
#   1) 有 appilot 安装前的备份 → 从最近备份完整还原（字节级一致）
#   2) 无备份且是 web profile → 用仓库内的官方模板还原
#      （scripts/restore/web-profile/，避免脚本内硬编码误伤其他 profile）
#   3) 其他情况 → 针对性清理（删 @appilot、npm 痕迹）
set -euo pipefail

PROFILE="${1:?用法: dsh-undo-appilot.sh <profile名>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"

echo "== 撤销 @appilot 对 profile「${PROFILE}」的改动 =="

# 0) 先备份现状（万一撤销本身出问题，还能回到现在）
"$HERE/dsh-profile-backup.sh" "$PROFILE"

# 1) 找最近的安装前备份（列表里最早的即安装前快照）
LATEST="$(ls -t "$HOME/.dsh/appilot-backups/"*"-$PROFILE.tar.gz" 2>/dev/null | tail -1 || true)"

if [ -n "$LATEST" ] && [ -f "$LATEST" ]; then
  echo "→ 从最近备份恢复: $LATEST"
  "$HERE/dsh-profile-restore.sh" "$LATEST"
  echo "✅ 已从备份还原 profile「${PROFILE}」"
  exit 0
fi

# 2) 无备份 + web profile → 用仓库官方模板
if [ "$PROFILE" = "web" ] && [ -d "$HERE/restore/web-profile" ]; then
  echo "→ 无历史备份，用官方模板还原 web profile"
  rm -rf "$PROFILE_DIR/node_modules/@appilot"
  rm -f "$PROFILE_DIR/package-lock.json"
  rm -f "$PROFILE_DIR/package.json" "$PROFILE_DIR/cordis.patch.yml" "$PROFILE_DIR/cordis.yml" "$PROFILE_DIR/pnpm-workspace.yaml"
  cp "$HERE/restore/web-profile/"* "$PROFILE_DIR/"
  echo "✅ web profile 已还原为官方形态（模板来自仓库 scripts/restore/web-profile/）"
  exit 0
fi

# 3) 兜底：针对性清理
echo "→ 无备份、非 web profile：针对性清理"
rm -rf "$PROFILE_DIR/node_modules/@appilot"
rm -f "$PROFILE_DIR/package-lock.json"
echo "✅ 已清理 $PROFILE 中的 @appilot 与 npm 痕迹"

echo "== 完成。如需完全还原请使用 dsh-profile-restore.sh =="
