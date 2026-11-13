#!/usr/bin/env bash
# Checks that a deployed site serves every file of the staged folder, byte for byte.
# Usage: tools/verify-live.sh <baseUrl-with-trailing-slash> <stagedDir> [attempts=30] [delaySeconds=10]
# Retries because a fresh deploy can take a moment to reach the CDN; every request carries a cache-buster.
set -u
url="${1:?base url}"; dir="${2:?staged dir}"; attempts="${3:-30}"; delay="${4:-10}"
[ -d "$dir" ] || { echo "::error::no staged folder at $dir"; exit 2; }
cd "$dir" || exit 2

check() {
  local bad=0 f want got
  while IFS= read -r f; do
    want="$(sha256sum "$f" | cut -d' ' -f1)"
    got="$(curl -fsS "${url}${f}?cb=${RANDOM}${RANDOM}" 2>/dev/null | sha256sum | cut -d' ' -f1)"
    if [ "$want" != "$got" ]; then echo "  not live yet (missing or different): $f"; bad=1; fi
  done < <(find . -type f | sed 's|^\./||' | sort)
  return $bad
}

for i in $(seq 1 "$attempts"); do
  if check; then
    n="$(find . -type f | wc -l | tr -d ' ')"
    echo "Every one of the $n published files is live and identical."
    exit 0
  fi
  echo "attempt $i of $attempts"; [ "$i" -lt "$attempts" ] && sleep "$delay"
done
echo "::error::The live site does not serve the staged files after $attempts attempts"
exit 1
