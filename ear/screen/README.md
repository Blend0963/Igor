# Igor's desk screen

One monitor, two machines: your PC on one input, Igor's machine (the one
with igor-ear and the graphics card) on the other, showing the wall
dashboard and nothing else. A USB switch moves the keyboard and mouse
between them, and the screen follows:

- **The machine that loses the keyboard sends the screen to the other**
  (DDC/CI input switching). A monitor obeys DDC/CI on the input it shows,
  so each side only ever sends the screen away.
- On the PC, an **Igor** icon in the dock sends the screen to the dashboard.
- From Home Assistant, the `igor_screen` event: `pc`, `dashboard`, `off`
  (sleep: the output is switched off and the monitor goes to standby), `on`,
  `toggle`. `app` with `app: sound`, `equalizer` or `bluetooth` opens
  pavucontrol, EasyEffects or Blueman over the dashboard (those three only);
  `close` closes them. A dashboard button, an automation or Igor fires it through a
  script. The state is `sensor.igor_screen`.
- While the PC is off (`pc_entity`, a ping), the screen stays on the dashboard.

## Igor's machine (Debian 13)

Needs igor-ear installed (`ear/install.sh`), the monitor's DDC/CI switched on
in its menu, and the USB switch's port passed to the virtual machine (by USB
port, so the keyboard can come and go).

```
bash ear/screen/install-vm.sh "http://<home assistant>:8123/<dashboard>/<view>"
sudo reboot
~/.local/share/igor-ear/run.sh screen --check
```

It installs sway, greetd, Chromium and ddcutil; opens a kiosk session at boot
on the graphics card only (`/dev/dri/igor-screen`); runs Chromium full screen
on the dashboard with the **Igor Journal (tablette)** theme (asked for in the
address, `?igor_theme=`); starts `igor-screen` (user service) for the keyboard
and Home Assistant's orders; starts EasyEffects (as a service) and Bluetooth's
agent in the kiosk session; switches off another login manager (LightDM for
XFCE…; the desktop stays installed); and turns off the graphics card's HDMI
sound so Igor keeps speaking through the sound card. Settings: `[screen]` in
`~/.config/igor-ear/config.toml`. Ctrl+Alt+Backspace leaves the kiosk.

Home Assistant should let the kiosk in without a password: a
`trusted_networks` auth provider for the machine's address, bound to a
dedicated non-admin user.

## The PC (Fedora Silverblue / secureblue, or any GNOME desktop)

```
bash ear/screen/pc/install-pc.sh
```

On an atomic Fedora it layers ddcutil first and asks for a reboot; run it
again afterwards. It installs `igor-screen-pc` (user service watching the
keyboard), the dock icon, and checks that the monitor answers. Settings:
`~/.config/igor-screen-pc.conf` (`VM_INPUT`, `BUS`, `KEYBOARD`).
