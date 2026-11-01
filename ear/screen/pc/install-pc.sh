#!/bin/bash
# The PC's half of Igor's desk screen, on Fedora (Silverblue, secureblue…)
# or any distribution with GNOME. Run as yourself (not root):
#   bash install-pc.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
FAILED=0
ok() { echo "OK      $1"; }
ko() { echo "ÉCHEC   $1"; FAILED=1; }
ROOT=sudo; command -v sudo >/dev/null 2>&1 || ROOT=run0

if ! command -v ddcutil >/dev/null 2>&1; then
    if command -v rpm-ostree >/dev/null 2>&1; then
        if rpm-ostree install --idempotent ddcutil; then
            ok "ddcutil ajouté au système"
            echo
            echo "Redémarre le PC (systemctl reboot), puis relance : bash $0"
            exit 0
        fi
        ko "rpm-ostree install ddcutil"; exit 1
    elif command -v dnf >/dev/null 2>&1; then
        $ROOT dnf install -y ddcutil && ok "ddcutil installé" || { ko "dnf install ddcutil"; exit 1; }
    elif command -v apt-get >/dev/null 2>&1; then
        $ROOT apt-get install -y ddcutil && ok "ddcutil installé" || { ko "apt-get install ddcutil"; exit 1; }
    else
        ko "installe ddcutil avec le gestionnaire de paquets de ta distribution"; exit 1
    fi
else
    ok "ddcutil présent"
fi

if ! [ -e /dev/i2c-0 ] && ! lsmod | grep -q '^i2c_dev'; then
    echo i2c-dev | $ROOT tee /etc/modules-load.d/igor-screen.conf >/dev/null && $ROOT modprobe i2c-dev \
        && ok "module i2c-dev" || ko "module i2c-dev"
else
    ok "module i2c-dev"
fi

mkdir -p "$HOME/.local/bin" "$HOME/.config/systemd/user" "$HOME/.local/share/applications"
install -m 755 "$HERE/igor-screen-pc" "$HOME/.local/bin/igor-screen-pc" && ok "programme igor-screen-pc" || ko "programme"
[ -f "$HOME/.config/igor-screen-pc.conf" ] || cat > "$HOME/.config/igor-screen-pc.conf" <<CONF
# Igor's desk screen, the PC's side.
VM_INPUT=0x11   # l'entrée de l'écran où est branchée la VM (0x11 HDMI 1)
BUS=            # vide : trouvé tout seul
KEYBOARD=       # vide : n'importe quel clavier USB
CONF
sed "s|%h|$HOME|g" "$HERE/igor-screen.desktop" > "$HOME/.local/share/applications/igor-screen.desktop" \
    && ok "icône Igor" || ko "icône"
install -m 644 "$HERE/igor-screen-pc.service" "$HOME/.config/systemd/user/" \
    && systemctl --user daemon-reload && systemctl --user enable --now igor-screen-pc.service \
    && ok "surveillance du clavier (service igor-screen-pc)" || ko "service igor-screen-pc"

# The icon in the dock.
if command -v gsettings >/dev/null 2>&1; then
    FAV=$(gsettings get org.gnome.shell favorite-apps 2>/dev/null)
    if [ -n "$FAV" ] && ! echo "$FAV" | grep -q igor-screen.desktop; then
        gsettings set org.gnome.shell favorite-apps "$(echo "$FAV" | sed "s/]$/, 'igor-screen.desktop']/; s/\[, /[/")" \
            && ok "icône Igor épinglée dans le dock" || ko "épingler l'icône"
    fi
fi

echo
python3 "$HOME/.local/bin/igor-screen-pc" check
if ddcutil detect --brief 2>/dev/null | grep -q "Display 1"; then
    ok "l'écran répond en DDC/CI"
else
    ko "l'écran ne répond pas en DDC/CI : active DDC/CI dans le menu de l'écran, puis relance"
fi
echo
[ "$FAILED" = 0 ] && echo "Tout est en place. Clique sur l'icône Igor du dock pour essayer." \
    || echo "Il y a des ÉCHEC ci-dessus : envoie-les à Claude."
