#!/usr/bin/env bash
# Frame-cost comparison of the working tree against an earlier commit, run back to back on this machine.
# Absolute numbers drift between sessions (the same code measured 3.0 ms one day and 2.2 ms the next), so a refactor must be
# judged by this side-by-side run, never against a number written down earlier.
# Usage: tools/perf-compare.sh <earlier-commit> [repeats=2] [rounds=2]
set -eu
base="${1:?commit to compare against}"; repeats="${2:-2}"; rounds="${3:-2}"
root="$(cd "$(dirname "$0")/.." && pwd)"; wt="$(mktemp -d)/before"
git -C "$root" worktree add -q "$wt" "$base"
trap 'git -C "$root" worktree remove --force "$wt"' EXIT
ln -s "$root/node_modules" "$wt/node_modules"
for r in $(seq 1 "$rounds"); do
  echo "round $r"
  printf '  before (%s): ' "${base:0:7}"; (cd "$wt" && node tools/perf.js "$repeats" | tr '\n' ' '); echo
  printf '  after  (working tree): ';       (cd "$root" && node tools/perf.js "$repeats" | tr '\n' ' '); echo
done
echo "Differences inside about +-15% between rounds are noise."
