#!/usr/bin/env bash
# Did a refactor change any pixel the game draws? Renders every golden scenario from an earlier commit and from the working tree, and
# compares the exact pixels (see tools/golden.mjs). About 1.5 minutes.
# Usage: tools/golden-compare.sh <earlier-commit>
set -eu
base="${1:?commit to compare against}"
root="$(cd "$(dirname "$0")/.." && pwd)"; tmp="$(mktemp -d)"; wt="$tmp/before"
git -C "$root" worktree add -q "$wt" "$base"
trap 'git -C "$root" worktree remove --force "$wt"; rm -rf "$tmp"' EXIT
ln -s "$root/node_modules" "$wt/node_modules"
echo "before: ${base:0:7}"; (cd "$wt" && node "$root/tools/golden.mjs" capture "$tmp/before-frames" "$wt")
echo "after: working tree"; (cd "$root" && node tools/golden.mjs capture "$tmp/after-frames")
node "$root/tools/golden.mjs" compare "$tmp/before-frames" "$tmp/after-frames"
