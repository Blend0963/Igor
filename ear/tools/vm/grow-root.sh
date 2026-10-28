#!/usr/bin/env bash
# Agrandit la partition / de la VM de l'oreille à tout le disque, après un
# « qm resize » côté Proxmox. La disposition Debian par défaut met la
# partition d'échange (sda5, dans sda2) juste après / : elle est retirée et
# remplacée par un fichier d'échange de 2 Go. Les données de / ne sont pas
# touchées. Chaque étape affiche OK ou ÉCHEC ; au premier ÉCHEC, le script
# s'arrête.
set -u
DISK=/dev/sda
LOG=/root/grow-root.log

step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s (journal : %s)\n' "$1" "$LOG"; exit 1; }

[ "$(id -u)" = 0 ] || { printf 'ÉCHEC — à lancer avec sudo\n'; exit 1; }
: >"$LOG"

step "1/7 Le disque a bien la disposition attendue"
[ "$(findmnt -no SOURCE /)" = "${DISK}1" ] || fail "/ n'est pas sur ${DISK}1"
[ "$(lsblk -no FSTYPE "${DISK}1")" = ext4 ] || fail "${DISK}1 n'est pas en ext4"
[ "$(lsblk -no FSTYPE "${DISK}5" 2>/dev/null)" = swap ] || fail "${DISK}5 n'est pas la partition d'échange attendue"
count=$(lsblk -lno NAME "$DISK" | grep -c "^$(basename "$DISK")[0-9]")
[ "$count" = 3 ] || fail "$count partitions sur $DISK, 3 attendues (sda1, sda2, sda5)"
SWAPUUID=$(lsblk -no UUID "${DISK}5")
ok "sda1 (/) puis sda2 contenant sda5 (swap)"

step "2/7 Outil growpart"
if ! command -v growpart >/dev/null; then
  apt-get install -y cloud-guest-utils >>"$LOG" 2>&1 || fail "installation de cloud-guest-utils"
fi
ok "growpart disponible"

step "3/7 Copie de sauvegarde de /etc/fstab"
cp -a /etc/fstab /etc/fstab.avant-agrandissement || fail "copie de /etc/fstab"
ok "/etc/fstab.avant-agrandissement"

step "4/7 Retrait de la partition d'échange"
swapoff "${DISK}5" >>"$LOG" 2>&1
swapon --show=NAME --noheadings | grep -q "${DISK}5" && fail "impossible d'arrêter ${DISK}5"
sfdisk --no-reread --delete "$DISK" 5 >>"$LOG" 2>&1 || fail "suppression de ${DISK}5"
sfdisk --no-reread --delete "$DISK" 2 >>"$LOG" 2>&1 || fail "suppression de ${DISK}2"
partx -d --nr 5 "$DISK" >>"$LOG" 2>&1
partx -d --nr 2 "$DISK" >>"$LOG" 2>&1
sed -i "/${SWAPUUID}/s/^/# /" /etc/fstab
ok "partitions 5 et 2 retirées, leur ligne mise en commentaire dans /etc/fstab"

step "5/7 Agrandissement de / sur tout le disque"
growpart "$DISK" 1 >>"$LOG" 2>&1 || fail "growpart"
resize2fs "${DISK}1" >>"$LOG" 2>&1 || fail "resize2fs"
ok "$(df -h / | awk 'NR==2 {print $2 " au total, " $4 " libres"}')"

step "6/7 Démarrage sans l'ancienne partition d'échange"
RESUME=/etc/initramfs-tools/conf.d/resume
if [ -f "$RESUME" ] && grep -q "$SWAPUUID" "$RESUME"; then
  cp -a "$RESUME" "$RESUME.avant-agrandissement"
  echo "RESUME=none" >"$RESUME"
  update-initramfs -u >>"$LOG" 2>&1 || fail "update-initramfs"
fi
grep -q "resume=" /etc/default/grub 2>/dev/null && fail "/etc/default/grub contient encore « resume= » : envoie cette ligne avant de redémarrer"
ok "plus aucune référence à l'ancienne partition"

step "7/7 Fichier d'échange de 2 Go"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >>"$LOG" 2>&1 || fail "création de /swapfile"
fi
swapon --show=NAME --noheadings | grep -q "^/swapfile" || swapon /swapfile >>"$LOG" 2>&1 || fail "activation de /swapfile"
grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >>/etc/fstab
ok "/swapfile actif et inscrit dans /etc/fstab"

printf '\nTerminé : %s\n' "$(df -h / | awk 'NR==2 {print $4 " libres sur " $2}')"
