#!/usr/bin/env bash
#
# Guard against private content reaching this public repository.
#
# Everything tracked here is published the moment it is pushed, and git history
# keeps it: deleting a file later does not unpublish it. This catches the usual
# accidents: a path from a developer machine, a real IP address, an API key or
# private key, a committed .env file.
#
# Run locally before pushing:  .github/scripts/check-public-content.sh

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

findings=0

# Tracked files only, minus vendored/generated trees, the license texts and
# this script (which would otherwise match its own patterns).
mapfile -t FILES < <(
  git ls-files -z |
    tr '\0' '\n' |
    grep -vE '(^|/)(node_modules|dist|build)/' |
    grep -vE '(^|/)(LICENSE|package-lock\.json|.*\.lock)$' |
    grep -vE '^\.github/scripts/check-public-content\.sh$'
)

report() { # <rule> <file:line> <detail>
  printf '  %-26s %s\n      %s\n' "$1" "$2" "$3"
  findings=$((findings + 1))
}

scan() { # <rule-name> <regex> [file-filter-regex] [allow-regex]
  local rule="$1" re="$2" filter="${3:-}" allow="${4:-}"
  local f ln text
  for f in "${FILES[@]}"; do
    [ -f "$f" ] || continue
    [ -n "$filter" ] && ! [[ "$f" =~ $filter ]] && continue
    while IFS=: read -r ln text; do
      [ -n "${ln:-}" ] || continue
      # An allow-regex exempts documented placeholders — the things a reader is
      # meant to substitute. It never exempts a file, only a specific shape.
      [ -n "$allow" ] && grep -qE "$allow" <<<"$text" && continue
      report "$rule" "$f:$ln" "$(printf '%.140s' "${text# }")"
    done < <(grep -nE "$re" "$f" 2>/dev/null)
  done
}

echo "Checking ${#FILES[@]} tracked files for private content…"
echo

# 1 — Absolute paths from a developer machine. Nobody outside can use them and
#     they expose someone's local layout. Conventional
#     placeholders in example config are what a reader is supposed to substitute,
#     so they stay green — and so do service accounts that live inside a
#     container image rather than on anyone's laptop (`pi`, and `shodh` from the
#     shodh-memory image, whose bundled models a Dockerfile has to copy
#     out of /home/shodh). Names are allowlisted one at a time on purpose: the
#     tempting alternative, skipping `COPY --from=` lines wholesale, would blind
#     the check to a real `/home/<developer>/` path inside a build stage.
scan "local-path" '/home/[a-z_][a-z0-9_-]*/' '' '/home/(user|username|youruser|your-user|your_user|me|pi|shodh|<[^>]+>|\$\{?[A-Z_]+)/'

# 2 — A bare routable IP address. Nothing here should ever point at a host by
#     number: the add-on talks to Home Assistant
#     by service name. A literal is therefore almost always someone's server.
#     Private, loopback, link-local and documentation ranges are fine.
#     Each address is judged on its own — a documentation-range example on the
#     same line must not mask a real host beside it.
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  while IFS=: read -r ln ip; do
    [ -n "${ip:-}" ] || continue
    [[ "$ip" =~ ^(0|10|127|255)\.|^169\.254\.|^192\.168\.|^192\.0\.2\.|^198\.51\.100\.|^203\.0\.113\.|^172\.(1[6-9]|2[0-9]|3[01])\. ]] && continue
    # Four-part version numbers (S6_OVERLAY_VERSION=3.2.0.2) are shaped exactly
    # like an address. A line that is declaring a version is not naming a host.
    line=$(sed -n "${ln}p" "$f")
    [[ "$line" =~ [Vv][Ee][Rr][Ss][Ii][Oo][Nn] ]] && continue
    report "routable-ip" "$f:$ln" "$ip"
  done < <(grep -noE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$f" 2>/dev/null)
done

# 3 — Real credentials. Deliberately requires a long tail so documented
#     placeholders like `sk-ant-api03-...` stay green.
scan "credential" 'sk-ant-api03-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|rk_live_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}'

# 4 — Wallet connection strings and private keys.
scan "secret-uri" 'nostr\+walletconnect://|nwc://|-----BEGIN [A-Z ]*PRIVATE KEY-----'

# 5 — A committed .env is almost always an accident.
for f in "${FILES[@]}"; do
  case "$f" in
    .env|*/.env|*.env.local|*/.env.production)
      report "env-file" "$f" "environment file is tracked in a public repo" ;;
  esac
done

echo
if [ "$findings" -gt 0 ]; then
  echo "FAIL — $findings finding(s). This repo is public; fix before pushing."
  echo "If a hit is a false positive, tighten the pattern rather than deleting the check."
  exit 1
fi
echo "PASS — no private content found in tracked files."
