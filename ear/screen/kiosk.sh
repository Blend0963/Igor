#!/bin/bash
# Chromium in kiosk mode on the wall dashboard, restarted if it closes.
# The address is [screen] url in ~/.config/igor-ear/config.toml; the tablet
# theme (without Home Assistant's top bar) is asked for in the address.
CONF="${IGOR_EAR_CONFIG:-$HOME/.config/igor-ear/config.toml}"
PROFILE="$HOME/.local/share/igor-ear/chromium"
URL=$(python3 -c '
import sys, tomllib
try:
    print(tomllib.load(open(sys.argv[1], "rb")).get("screen", {}).get("url", ""))
except Exception:
    print("")
' "$CONF")
[ -n "$URL" ] || URL="about:blank"
case "$URL" in
    *igor_theme=*|about:*) ;;
    *\?*) URL="$URL&igor_theme=Igor%20Journal%20(tablette)" ;;
    *) URL="$URL?igor_theme=Igor%20Journal%20(tablette)" ;;
esac
mkdir -p "$PROFILE"
LIMIT=""
if systemd-run --user --scope --quiet true 2>/dev/null; then
    LIMIT="systemd-run --user --scope --quiet -p CPUQuota=110% -p MemoryHigh=900M -p MemoryMax=1200M"
fi
while true; do
    # After a power cut Chromium would offer to restore the pages: told it closed cleanly.
    sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' \
        "$PROFILE/Default/Preferences" 2>/dev/null
    # Igor, Whisper and the sound come first: Chromium runs at low priority,
    # capped near one core and 1.2 GB (a systemd scope; plain if there is none),
    # drawn by the graphics card, with few processes.
    $LIMIT nice -n 10 chromium --ozone-platform=wayland --kiosk --no-first-run --noerrdialogs \
        --disable-session-crashed-bubble --disable-infobars --password-store=basic \
        --disable-features=Translate --check-for-update-interval=31536000 \
        --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy \
        --renderer-process-limit=2 --disable-background-networking --disable-sync \
        --disable-extensions --disable-component-update \
        --user-data-dir="$PROFILE" "$URL"
    sleep 3
done
