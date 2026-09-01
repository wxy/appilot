#!/usr/bin/env bash
# dsh-undo-appilot.sh — 撤销 @appilot/* 对某个 profile 的全部改动（先备份）
#
# 用法：
#   scripts/dsh-undo-appilot.sh web     # 撤销 web profile 里的 appilot 安装
#
# 动作（全部可逆，先自动备份）：
#   1. 备份 profile 目录到 ~/.dsh/appilot-backups/
#   2. 删除 profile node_modules 里的 @appilot/*（以及 npm 残留的 package-lock.json）
#   3. 若 package.json 里含有 @appilot/dsh 依赖或 bundle，还原为官方 web profile 形态
#   4. 删除我创建的独立 appilot profile（~/.dsh/profiles/appilot）
#
# 说明：web profile 是 pnpm 管理的（pnpm-workspace.yaml），
# 正确安装方式应为 `dsh plugin --profile web add <pkg>`，切勿用 npm install。
set -euo pipefail

PROFILE="${1:?用法: dsh-undo-appilot.sh <profile名>}"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "== 撤销 @appilot 对 profile「$PROFILE」的改动 =="

# 1) 备份
if [ -d "$PROFILE_DIR" ]; then
  DEST="$HOME/.dsh/appilot-backups/$STAMP-$PROFILE"
  mkdir -p "$HOME/.dsh/appilot-backups"
  cp -R "$PROFILE_DIR" "$DEST"
  echo "✅ 备份 → $DEST"
fi

# 2) 删除 appilot 残留与 npm 痕迹
if [ -d "$PROFILE_DIR/node_modules/@appilot" ]; then
  rm -rf "$PROFILE_DIR/node_modules/@appilot"
  echo "✅ 已删除 $PROFILE_DIR/node_modules/@appilot"
fi
if [ -f "$PROFILE_DIR/package-lock.json" ]; then
  rm -f "$PROFILE_DIR/package-lock.json"
  echo "✅ 已删除 npm 生成的 package-lock.json"
fi

# 3) 还原 package.json（若含 appilot）
PKG="$PROFILE_DIR/package.json"
if [ -f "$PKG" ] && grep -q '@appilot' "$PKG"; then
  cat > "$PKG" << 'EOF'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app"
      ]
    }
  }
}
EOF
  echo "✅ 已还原 $PKG 为官方形态"
fi

# 4) 删除独立 appilot profile
if [ -d "$HOME/.dsh/profiles/appilot" ]; then
  rm -rf "$HOME/.dsh/profiles/appilot"
  echo "✅ 已删除 ~/.dsh/profiles/appilot"
fi

echo "== 完成。重启 GUI：dsh web =="
