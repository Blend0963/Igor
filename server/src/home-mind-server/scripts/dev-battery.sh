#!/usr/bin/env bash
# Batterie de tests "Igor Code dev mode" — vérifie que la sandbox est opérationnelle
# de bout en bout : git, apt, outils, exécution de tests, et longue chaîne de commandes.
set -u
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
check(){ if [ "$2" -eq 0 ]; then ok "$1"; else bad "$1"; fi }

echo "== 1. Système =="
uname -a >/dev/null 2>&1; check "uname -a" $?
cat /etc/os-release | grep -q . ; check "os-release lisible" $?

echo "== 2. Git =="
cd "$(dirname "$0")/../../../.." || exit 1
git rev-parse --is-inside-work-tree >/dev/null 2>&1; check "dépôt git valide" $?
git status --porcelain >/dev/null 2>&1; check "git status" $?
git log -1 --oneline >/dev/null 2>&1; check "git log" $?
git branch --show-current >/dev/null 2>&1; check "git branch" $?

echo "== 3. apt =="
apt-get --version >/dev/null 2>&1; check "apt-get présent" $?
sudo -n apt-get update -qq >/dev/null 2>&1 || apt-get update -qq >/dev/null 2>&1
check "apt-get update" $?
apt-cache policy nodejs 2>/dev/null | grep -qE "Candidat|Candidate"; check "apt-cache interrogeable" $?

echo "== 4. Node / npm / test runner =="
node --version >/dev/null 2>&1; check "node $(node --version)" $?
npm --version >/dev/null 2>&1; check "npm $(npm --version)" $?
cd server/src/home-mind-server
npx vitest run src/llm/client.test.ts >/dev/null 2>&1; check "vitest (client.test.ts)" $?

echo "== 5. Longue chaîne de commandes (anti-timeout) =="
for i in $(seq 1 25); do echo "step $i/25 ok"; done > /tmp/battery-steps.txt 2>&1
[ "$(wc -l < /tmp/battery-steps.txt)" -eq 25 ]; check "25 commandes d'affilée sans coupure" $?

echo "== 6. Fichiers =="
echo "battery $(date -Is)" >> /tmp/battery-runs.log
[ -s /tmp/battery-runs.log ]; check "écriture fichier" $?

echo
echo "Résultat: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
