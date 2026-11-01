#!/bin/bash
# Igor's desk screen on this machine (Debian 13): the wall dashboard on the
# graphics card's HDMI output, the screen handed over to the PC with the USB
# keyboard, put to sleep by Home Assistant. Run as the user of igor-ear:
#   bash install-vm.sh "http://<home assistant>:8123/<dashboard>/<view>"
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HOME/.local/share/igor-ear"
CONF="$HOME/.config/igor-ear"
URL="${1:-}"
FAILED=0
ok() { echo "OK      $1"; }
ko() { echo "ÉCHEC   $1"; FAILED=1; }
step() { if eval "$2" >/tmp/igor-screen-step.log 2>&1; then ok "$1"; else ko "$1 (voir /tmp/igor-screen-step.log)"; fi; }

[ -x "$APP/run.sh" ] || { ko "igor-ear n'est pas installé ($APP/run.sh) : lance d'abord ear/install.sh"; exit 1; }
rm -rf "$APP/igor_ear" && cp -r "$HERE/../igor_ear" "$APP/" && ok "programme d'igor-ear mis à jour" || ko "programme d'igor-ear"

step "paquets (sway, greetd, chromium, ddcutil, réglages son et Bluetooth)" "sudo apt-get install -y sway swayidle greetd chromium ddcutil i2c-tools pavucontrol blueman easyeffects"
step "module i2c-dev (DDC/CI)" "echo i2c-dev | sudo tee /etc/modules-load.d/igor-screen.conf && sudo modprobe i2c-dev"
step "groupes i2c, video, render, input pour $USER" "sudo usermod -aG i2c,video,render,input $USER"
step "nom fixe de la carte graphique (/dev/dri/igor-screen)" \
    "sudo install -m 644 '$HERE/71-igor-screen.rules' /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger -s drm"

mkdir -p "$APP/screen" "$CONF" "$HOME/.config/systemd/user" "$HOME/.config/wireplumber/wireplumber.conf.d"
install -m 755 "$HERE/kiosk.sh" "$APP/screen/kiosk.sh" && install -m 644 "$HERE/sway.conf" "$CONF/sway.conf" \
    && install -m 644 "$HERE/igor-screen.service" "$HOME/.config/systemd/user/igor-screen.service" \
    && systemctl --user daemon-reload && ok "session kiosque (sway, chromium, igor-screen)" || ko "session kiosque"
install -m 644 "$HERE/52-igor-no-hdmi-audio.conf" "$HOME/.config/wireplumber/wireplumber.conf.d/" \
    && ok "son HDMI de l'écran désactivé (au prochain démarrage)" || ko "règle WirePlumber"

if [ -f /etc/greetd/config.toml ] && ! grep -q igor-screen /etc/greetd/config.toml; then
    sudo cp /etc/greetd/config.toml /etc/greetd/config.toml.avant-igor
fi
sudo tee /etc/greetd/config.toml >/dev/null <<TOML
# igor-screen: the kiosk session, at boot and after any restart of greetd.
[terminal]
vt = 7

# The kiosk at boot (initial_session, once per boot) and after any restart
# of greetd (default_session): no login prompt that would only loop.
[initial_session]
command = "env WLR_DRM_DEVICES=/dev/dri/igor-screen sway --config $CONF/sway.conf"
user = "$USER"

[default_session]
command = "env WLR_DRM_DEVICES=/dev/dri/igor-screen sway --config $CONF/sway.conf"
user = "$USER"
TOML
[ $? -eq 0 ] && ok "ouverture automatique de la session (greetd)" || ko "greetd"
# Another login manager (LightDM for XFCE…) holds the place: it is switched
# off, its desktop stays installed. The kiosk session starts what it started
# for the sound (EasyEffects) and Bluetooth (blueman-applet).
DM=$(readlink /etc/systemd/system/display-manager.service 2>/dev/null)
DM=$(basename "${DM:-}" 2>/dev/null)
if [ -n "$DM" ] && [ "$DM" != "greetd.service" ]; then
    step "$DM désactivé (le bureau reste installé)" "sudo systemctl disable $DM"
fi
step "greetd au démarrage" "sudo systemctl enable greetd"

# [screen] in igor-ear's settings, once.
if ! grep -q '^\[screen\]' "$CONF/config.toml" 2>/dev/null; then
    [ -n "$URL" ] || read -r -p "Adresse du tableau de bord (ex. http://10.45.70.1:8123/dashboard-igor/maison) : " URL
    cat >> "$CONF/config.toml" <<TOML

[screen]
url = "$URL"
output = "HDMI-A-1"
here_input = "hdmi"
pc_input = "dp"
keyboard = ""
pc_entity = ""
TOML
    ok "[screen] ajouté à $CONF/config.toml"
elif [ -n "$URL" ]; then
    sed -i "/^\[screen\]/,/^\[/ s|^url = .*|url = \"$URL\"|" "$CONF/config.toml" && ok "adresse du tableau de bord mise à jour"
fi

echo
if [ "$FAILED" = 0 ]; then
    echo "Tout est en place. Redémarre la VM : sudo reboot"
    echo "Puis vérifie :  $APP/run.sh screen --check"
else
    echo "Il y a des ÉCHEC ci-dessus : envoie-les à Claude avant de redémarrer."
fi
