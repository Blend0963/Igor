# Igor

Igor is an AI assistant for Home Assistant with persistent memory, conversation history, Home Assistant tools, automation management, and optional independent web search.

## Quick start

1. Install the Igor add-on from this repository in Home Assistant.
2. In the add-on Configuration tab, set **LLM Mode** to **BYOK** and choose a supported provider.
3. Enter your provider API key, model, and optional base URL.
4. Optionally set **Mistral API Key (Web Search)**.
5. Start the add-on. Restart Home Assistant if prompted, then select **Igor** as your Assist conversation agent.

## Language model providers

Igor supports Anthropic, OpenAI, OpenRouter, and Ollama through its BYOK configuration. For OpenAI-compatible providers, use the provider's API key, model name, and base URL as applicable. For a local model, configure Ollama on a reachable host and use its OpenAI-compatible endpoint.

The model must support tool/function calling to control Home Assistant. Capabilities vary by model and provider.

## Web search

Web search is optional and independent from the language model provider. Enter a Mistral API key in **Mistral API Key (Web Search)**. Igor uses Mistral's native `web_search` tool through the Conversations API when external/current information would help answer a question. This key is separate from the selected chat provider. Without it, web search is disabled; Home Assistant tools, memory, and history continue to work normally.

Search queries are sent to Mistral when the tool is used. Search results are external content and may be inaccurate or malicious; Igor treats them as source material rather than instructions.

## Memory and conversation history

Igor stores its memory and conversation history on the Home Assistant host. Memory is used to recall durable preferences and facts across conversations; conversation history provides recent turn context. These are distinct features. When a hosted LLM is configured, the current request and relevant context are sent to that provider. For maximum local control, use a local model endpoint and disable web search if you do not want external search requests.

## Home Assistant tools and automations

Igor can inspect entity states, search exposed entities, retrieve historical sensor data, call Home Assistant services, and create/list/edit/delete automations. Automation changes use a preview-and-confirm flow where supported. New automations are named with the **Igor:** prefix.

Keep only the entities you intend the assistant to control exposed to Assist, and review automation previews before confirming.

## Voice

Igor works as a Home Assistant Assist conversation agent. Speech-to-text and text-to-speech are configured through your Home Assistant pipeline or separately configured voice providers. Supported voice features depend on the chosen provider and model.

## Wall tablet

A tablet that shows Home Assistant all day (Fully Kiosk Browser, the companion app or any browser) can show each voice request full screen while it happens: the bow tie and "Je vous écoute…" as soon as the satellite hears the wake word, your words once transcribed, Igor's butler phrases with the time spent, the answer as it is written and the action chips. It fades back to the dashboard a few seconds after the satellite stops talking; a tap closes it.

With igor-ear (the listener in `ear/` that needs no wake word), the tablet shows "Je vous ai entendu…" the moment it hears "Igor", a few seconds before the words reach Igor ("Je vous écoute…" when the name came alone, and while Igor waits for the answer to a question of its own). igor-ear calls the integration's `nives.heard` service for this.

1. Restart Home Assistant once after updating, so it loads the new integration files.
2. On the tablet, open Home Assistant once with `?igor_tablet=1` at the end of the address, for example `http://homeassistant.local:8123/lovelace/0?igor_tablet=1`. In Fully Kiosk Browser, put it in the Start URL. With several satellites, `?igor_tablet=assist_satellite.living_room` follows that one only. `?igor_tablet=0` switches it off. The choice is kept by that browser only; other devices are not affected. The tablet then shows Igor's journal while it works: your words, each step of the local model (marked local or online, with its time), what was done, and Igor's answer, in a plain terminal light enough for an old tablet. The history, Igor's last 100 spoken exchanges by day, each with its steps, opens from the **Igor journal** card's « historique » (below), or from any card with the action `tap_action: {action: fire-dom-event, igor_journal: true}` (tap, hold or double tap); **fermer** closes it, and a new request takes the screen back. The history is kept on the add-on's disk (the newest 1,000 exchanges), never sent anywhere.

It reads the satellite's state and the **Igor Assist** sensor, which follows each voice request. The texts are not kept in the history and are cleared three minutes after the answer, but any Home Assistant account can read the latest exchange while it is there. To turn the sensor and the display off: Settings → Devices & services → Igor → Configure → Wall-tablet display.

## Reminders, alerts and the house watch

Reminders and alerts go to the **Notification Service** option: a notify service (`mobile_app_my_phone`, or `telegram` for a YAML Telegram notifier), a notify entity (`notify.telegram_bot_123_456` for a Telegram bot set up from the UI), or `telegram_bot` / `telegram_bot:<chat id>`. They appear as a notification inside Home Assistant when it is empty. The ⏰ button of the panel lists them and cancels them.

- **Reminders**: "remind me in 5 minutes", "tomorrow at 3 pm", "in 6 days at 6 pm", "every Tuesday at 7 pm". Igor passes what you said and the add-on computes the date itself (time zone and daylight saving included), then repeats the exact date with its weekday. Reminders cost nothing when they fire.
- **When something happens**: "tell me when the washing machine is done" (its power below 5 W for 3 minutes), "tell me when someone gets home". Checked every 30 seconds, for free; dropped after 24 hours (up to a week) if it never happens.
- **House watch** (option **House Watch**, off by default): every 5 minutes plain checks look for water leaks, smoke, gas, a triggered alarm, doors and windows open for half an hour, a jammed lock, low batteries, devices that stopped answering, extreme temperatures, failed automations, and lights left on while everyone is out. Only something new is shown to the cheap model, which writes a short notification or decides it is normal (a freezer is cold). Safety alarms are always sent, even during the quiet hours; the rest waits for the end of the quiet hours and is capped per day. Alerts are also written into the "Veille de la maison" thread, where you can answer them. "on" watches the entities exposed to Assist; "all" the whole house (the watch only reports, it never acts).
- **Daily useful tip** (option **Daily Useful Tip Time**): once a day Igor looks at the weather forecast and the house, and writes only when something is worth it, such as frost tonight with a window open.

## Reviewing your automations and configuration

In the panel or in written Assist, Igor can read the full configuration of an automation, script or scene, the recent runs of your automations (which fail, which never run, which run too often), and the YAML files of your configuration folder (`configuration.yaml`, `packages/`, blueprints…). Ask "review my automations and tell me what could be improved". `secrets.yaml` is never read and values under keys such as `password`, `token` or `api_key` are masked.

With the **Configuration Changes** option set to `yaml` (it is `automations` by default, `off` makes Igor read-only), Igor can also **change** these YAML files (scripts.yaml, configuration.yaml, packages…, never `secrets.yaml`), always in two steps: it first shows the exact lines it will remove and add, and asks whether you want a backup copy of the current file (optional: a `.bak` file next to it). Only after your yes is the file written; Home Assistant's configuration check runs right after, and if it fails the previous content is put back automatically. Scripts, automations and scenes are reloaded; for other files Igor tells you which reload applies or that a restart is needed. Hidden secret values stay as they are in the file.

## Installed app (PWA) and sharing from the phone

The chat panel can also be installed as an app on a phone or a computer, outside Home Assistant. Installed, Igor appears in Android's **Share** menu: a PDF, a photo, a Word or Excel file, a link or a piece of text shared to Igor opens a new thread with it already attached, ready to send with a question.

Installing needs the panel served on its own HTTPS address, which Home Assistant ingress cannot give:

1. In the add-on's **Network** settings, give port 3100 a host port (for example 3100) and restart the add-on.
2. Put your reverse proxy (Nginx, Caddy, Traefik…) in front of it, on an HTTPS name of your choice, for example `https://igor.example.org/` → `http://<home-assistant-host>:3100/`. Replies stream as server-sent events: turn response buffering off for that location (Nginx: `proxy_buffering off;`, and a `proxy_read_timeout` of a few minutes). Allow request bodies of at least 80 MB (`client_max_body_size 80m;`) for attached files. The app can also live under a sub-path (`/igor/`) as long as the proxy strips it.
3. Open that address in the phone's browser and choose **Install app** (Chrome) or **Add to Home Screen** (Safari).
4. Outside Home Assistant there is no HA login in front of Igor, so the server asks for its API key (always required since 0.9.3; an address that keeps sending wrong keys is shut out for 15 minutes). If you think the key leaked, turn on **Regenerate the API token** and restart the add-on, then restart Home Assistant once and paste the new key into the app. Open the Igor panel inside Home Assistant, tap 🔑: it shows the key with a **Copy** button. Paste it in the installed app's 🔑. The key gives full access to Igor, and through it to your home: only publish the port behind HTTPS, and preferably behind your VPN or your proxy's own authentication.

Sharing files to Igor works on Android (Chrome, Edge, Samsung Internet). iOS does not let web apps receive shares; there, open Igor and use 📎.

## Troubleshooting

- **Web search says it is not configured:** add a Mistral key to **Mistral API Key (Web Search)**, save, and restart the add-on.
- **Device controls do not work:** check that the selected model supports tool calling and that the target entities are exposed to Assist.
- **The assistant does not appear in Assist:** follow any restart-required notification or repair in Home Assistant.

## License

Igor is free software under the **GNU AGPL-3.0**. See [LICENSE](../LICENSE).

## The Igor Journal theme

The add-on installs a Home Assistant theme in the style of the wall tablet's journal: dark grey, thin lines, small corners, a monospace face everywhere (the device's own), green for what is on, amber for warnings, Igor's blue as the accent, with a light version. It lands in `/config/themes/igor-journal.yaml` and is replaced when it changes (copy it under another name to adapt it).

Home Assistant reads themes from that folder once `configuration.yaml` holds:

```yaml
frontend:
  themes: !include_dir_merge_named themes
```

The theme also recolours the named colours cards use (Mushroom's `green`, `amber`, `pink`…), so an existing dashboard follows it. Restart Home Assistant once after adding it, then pick **Igor Journal** in your profile (Profile → Theme). Each device keeps its own choice.

**Igor Journal (tablette)** is the same theme without Home Assistant's top bar, for a wall tablet: pick it on the tablet only (or add `?igor_theme=Igor%20Journal%20(tablette)` to the dashboard's address on that device); its sidebar is hidden too. A monitor shared with a PC can show the dashboard from Igor's machine: see `ear/screen/README.md`. The bar comes back while you edit the dashboard (open it with `?edit=1` at the end of the address), or with `?barre` in the address.

## Wall dashboard cards

The integration adds cards for a tablet screen filled to the bottom, in the theme's style. Put them in a **panel** view:

- `custom:igor-wall` takes the whole screen: a one-line **status bar** on top that scrolls slowly through your machines (a touch opens the detail of each), then **columns** of cards that reach the bottom of the screen. Each column lists cards, `heading: <title>` for a small title, and `grow: true` with `card: <a card>` for the card that takes the height left. On a phone the columns stack. `above:` and `below:` take cards across the whole width, over and under the columns (a band that comes and goes with a `conditional` card, a row of apps). In the bar, `speed: auto` keeps the line still while it fits and otherwise scrolls it once every `pause` seconds (10 by default); `name: 407` follows IGOR, and `tabs: true` keeps the pages' tabs on a narrow screen (a car's head unit).
- `custom:igor-journal-card`: Igor's last exchanges (newest on top), what was done and how long each step took, today's count; « historique » opens the full history.
- `custom:igor-docker-card`: the containers of the Portainer integration, each with its load, memory, image and uptime; a stopped one turns red.
- `custom:igor-net-card`: a router's traffic down and up over the last hour (`down`, `up`, with `scale: 0.008` for kB/s shown in Mb/s), its gateway and extra figures.
- `custom:igor-energy-card`: a power sensor now, and hour by hour today (from Home Assistant's statistics).
- `custom:igor-camera-card`: a camera's picture, refreshed every `interval` seconds (10 by default; light for an old tablet).
- `custom:igor-weather-card`: now, hour by hour (`hours`) and the next days as temperature bars (`days`); when the weather entity's current state is unavailable, its forecast's first hour stands in.
- `custom:igor-assist-card`: Igor himself, its state in words; a tap talks to it (`satellite`), a long press or the « assist » pill switches it on or off (`assist`).
- `custom:igor-buttons-card`: a row of small buttons, each calling a service (`buttons: [{icon, name, service, data}]`), opening a page of Home Assistant (`navigate: /config`) or its sidebar (`menu: true`), or any Home Assistant action (`tap_action: {action: url, url_path: 'app://com.waze'}`, `{action: assist}`, a `perform-action` with `confirmation`). `size: big` gives buttons to touch on a phone or in a car (three a row unless `columns`); a lone big button lies flat as a band; `eye: true` shows Igor's eye, `color` tints a button, `secondary` adds a line. With the tablet theme, a page left untouched for 5 minutes (`return_after` on the wall) goes back to the wall.
- `custom:igor-alarm-card`: an alarm clock of the Alarm Clocks integration (`device_id`) on one line: time, days, time left, on/off pill, snooze and dismiss while it rings; a tap opens its full card.
- `custom:igor-mini-card`: a sensor's value with its range and line over 24 hours.
- `custom:igor-proxmox-card`: the Proxmox VE integration's node, VMs and containers (state, uptime, processor, memory used of total, disk), then its storages, ZFS pools and disks, all found from its devices.
- `custom:igor-docker-manage-card`: Portainer's totals and clean-up buttons, and each container with its state, an « maj » badge when a new image is out, and its buttons (pause, resume, restart, recreate, stop). Recreating, stopping and cleaning up act at the second press only, within 4 seconds.
- `custom:igor-history-card`: a few sensors over the last hours (`entities`, `hours`).
- `custom:igor-tiles-card`: large buttons for a finger from afar (`tiles: [{entity, name, icon, tap, secondary}]`): a scene activates, a light, switch, fan or cover toggles, a media player plays or pauses, a long press opens the details; `size: small` gives one line per tile.
- `custom:igor-control-card`: one device and its buttons (a cover's up/stop/down, a vacuum's start and dock).
- `custom:igor-clock-card`: the time, large, and the date; `igor-weather-card` takes `clock: false` beside it, and `igor-assist-card` takes `size: big` for a microphone button.
- `custom:igor-alerts-card`: what is wrong, first: Proxmox machines stopped or short of memory, hot disks, stopped containers (with « relancer »), images to update and the internet gateway (`gateway`), under a summary of machines, containers and internet. For a phone dashboard.

The Proxmox and Docker cards fold into one column on a phone.

A second wall (another panel view with `home: false`, so the screen still comes back to the first one) makes a homelab page; `links: [{name, navigate}]` on the status bar puts a button to it in the bar's detail.

The network card lists, with `gateways: auto` and `interfaces: auto`, the router's gateways and its interfaces busiest first (OPNsense's sensors, found from `down`). The Docker card leaves out containers whose entities are unavailable (removed from Docker); `show_unavailable: true` keeps them. In the status bar, a group with `side: true` goes to the right of the detail as a list (a router, the disks); the others form its table.

The service `nives.screen` (`action`: `pc`, `dashboard`, `off`, `on`, `toggle`, `app` with `app`: `sound`, `equalizer`, `bluetooth`, or `close`) gives orders to the desk screen (`ear/screen/README.md`); any user can call it from a button.

```yaml
type: custom:igor-wall
bar:
  speed: 60            # seconds per turn; 0 shows the machines page by page, without movement
  groups:
    - name: pve
      kind: hôte
      status: binary_sensor.node_pve_status        # the name turns red when it is off
      items:
        - { entity: sensor.node_pve_cpu_used, label: cpu }
        - { entity: sensor.disk_pve_ssd_temperature, label: ssd, warn: 50, bad: 60 }
    - name: vm-docker
      kind: vm 103
      items:
        - { entity: sensor.local_containers_running, of: sensor.local_container_count, label: conteneurs }
    - name: router
      kind: routeur
      items:
        - { entity: sensor.router_wan_in, label: "↓", scale: 0.008, unit: Mb/s }
        - { entity: sensor.router_gateway_status, label: wan, good: [online] }
columns:
  - cards:
      - heading: énergie
      - grow: true
        card: { type: custom:igor-energy-card, entity: sensor.power }
  - width: 1.15
    cards:
      - heading: igor
      - grow: true
        card: { type: custom:igor-journal-card }
```

A figure in % turns amber from 80 and red from 95, a temperature from 65 °C and 80 °C (`warn` and `bad` change it). `detail:` on a group lists more figures for the detail than the bar shows. igor-ear 0.2.5 sends its machine's AMD graphics card (load, temperature, video memory) as `sensor.igor_ear_gpu_load`, `_gpu_temperature` and `_gpu_memory`, ready for the bar.

## Network cards (administrators)

Three cards show what goes through the house's network. Their services are for **administrators only**: the DNS log is the house's browsing history. Nothing is stored.

- `custom:igor-dns-card`: AdGuard Home's DNS queries as they come (`nives.dns_log`), through Home Assistant's AdGuard integration.
- `custom:igor-map-card`: where those queries' answers point to, per country and operator, on a world map (`nives.dns_map`). Addresses are located on the Home Assistant host with DB-IP's free lite databases, downloaded on first use and monthly.
- `custom:igor-wifi-card`: who is on which Wi-Fi of OpenWrt access points (`nives.wifi_clients`), with signal, link rates and connection time.
- `custom:igor-netmap-card`: the network by VLAN around OPNsense, to look after it (`nives.net_map`): one block per network with its gateway and devices, flows through OPNsense, the internet's operators on the right. Layouts « Par VLAN », « Arbre » and « Libre », zoom, filters per network, search; devices and blocks move with the finger and stay where they are put. A tap on OPNsense, a network or a device gives its detail. Only what crosses the router is seen; two devices of the same network talk out of its sight.
- `custom:igor-talkers-card`: the busiest devices through the router.
- `custom:igor-wifi-scan-card`: the Wi-Fi networks around and the channels in use, heard by the OpenWrt access points when « scanner » is pressed (`nives.wifi_scan`; the ACL below needs `scan`). A radio may pause a second or two while it listens.
- `custom:igor-car-card`: a car while it drives (an OBD2 bridge such as obd2mqtt): the speed in large, the engine speed as a segmented bar (`rpm_warn`, `rpm_bad`, `rpm_max`), the coolant and the battery, the trip's distance, consumption and eco score (`speed`, `rpm`, `coolant`, `battery`, `online`, `trip: {entity, attribute}`, `active`, `consumption`).
- `custom:igor-carmedia-card`: the music of a car's Android head unit, from the companion app's media session sensor (`session`, `fallback`), with previous, play or pause and next sent as `command_media` (`notify`, `package`).

### A read-only OpenWrt login for the Wi-Fi card

Igor reads OpenWrt through ubus (the `/ubus` address LuCI uses) with a login that may only list wireless interfaces and their stations. On the access point, over SSH:

```sh
cat > /usr/share/rpcd/acl.d/igor.json <<'JSON'
{ "igor": { "description": "Igor, read-only Wi-Fi",
  "read": { "ubus": { "iwinfo": ["devices", "info", "assoclist", "scan"], "luci-rpc": ["getHostHints"] } } } }
JSON
HASH=$(uhttpd -m 'a long password')
uci add rpcd login
uci set rpcd.@login[-1].username='igor'
uci set rpcd.@login[-1].password="$HASH"
uci add_list rpcd.@login[-1].read='igor'
uci commit rpcd
/etc/init.d/rpcd restart
```

Then in `configuration.yaml` (one entry per access point, the password in `secrets.yaml`) and restart Home Assistant:

```yaml
nives:
  openwrt:
    - url: http://192.168.1.2
      name: salon
      username: igor
      password: !secret openwrt_igor
```

An access point used as a bridge often knows no names: Igor takes them from Home Assistant's device trackers (their `mac` attribute), and the card's `names: { "AA:BB:CC:DD:EE:FF": tablette }` names the rest.

### A read-only OPNsense key for the network map

In OPNsense, **System → Access → Users**: add a user `igor` (a long random password, no shell). In its **privileges**, tick only these (their exact names in the list):

| Privilege | What Igor reads with it |
| --- | --- |
| `Diagnostics: ARP Table` | which address is which device |
| `Diagnostics: Show States` | who talks to whom (the map's flows) |
| `Diagnostics: Logs: Firewall: Live View` | what the firewall refused (red dashes) |
| `Firewall: Rules [new]` | each network's rules (recent OPNsense versions) |
| the leases of your DHCP server: `Services: DHCP: Kea(v4)`, `Services: Dnsmasq DNS/DHCP: Settings`, or for ISC `Status: DHCP leases` (`Services: ISC DHCPv4: Leases` on 26.1 and later) | the devices' names |

OPNsense grants by page, not by read or write: « Show States », « Firewall: Rules [new] » and the DHCP ones would also allow changes through the API. Igor only calls the reading ones; keep the key in `secrets.yaml` and nowhere else.

The **OPNsense integration** for Home Assistant (hass-opnsense: CPU, memory, gateways, interfaces, WireGuard…) needs its own key. Rather than admin, give that user only what you use and turn on « Granular Sync Options » in the integration: `Lobby: Dashboard`, `Status: Interfaces` and `System: Firmware` always; `System: Gateways` (gateways), `Reporting: Traffic` (live traffic), `VPN: WireGuard: Status` (WireGuard), `Status: Services` (services), `System: Status` (notices), `Diagnostics: ARP Table` (device trackers), the DHCP leases above (lease counts). Its full list: the integration's `docs/granular_permissions.md`.

Save, then under **API keys** press **+**: a file with the key and the secret downloads. In `secrets.yaml` and `configuration.yaml`, then restart Home Assistant:

```yaml
nives:
  opnsense:
    url: https://192.168.1.1
    key: !secret opnsense_igor_key
    secret: !secret opnsense_igor_secret
    verify_ssl: false        # OPNsense's own certificate
```

Igor only reads: the ARP table and the leases name the devices, the states say who talks to whom. With OpenWrt access points configured, a Wi-Fi device also shows its network and signal.

### The house key

In Igor's options (Settings → Devices & services → Igor → Configure), the **key** is a binary sensor (a USB key's presence, say). While it is away (off, unknown or unavailable), Igor refuses every request: spoken, typed in Assist, and written in Igor's own thread panel (« Igor est verrouillé : la clé est absente. »). The desk screen's guard window and the tablet's lock page cover the screens themselves.

Some people are still answered while the key is away, from their phone, at home or outside: list them in the `nives:` block of `configuration.yaml`, by Home Assistant user name or id:

```yaml
nives:
  allowed_users: [Moi]
```

Give the wall, the tablet and the desk screen a Home Assistant account of their own (not yours): an account in `allowed_users` keeps the thread panel open wherever it is logged in. The installed app, which uses Igor's API key rather than a Home Assistant login, is not checked: whoever holds the key is the owner.

### Names

The network cards name devices from OPNsense's DHCP leases and ARP table, Home Assistant's device trackers and the access points. Devices with a fixed address often have no name there; give them one in the `nives:` block, by MAC or IP (it wins over the rest):

```yaml
nives:
  names:
    "AA:BB:CC:DD:EE:FF": Téléviseur
    192.168.1.20: nas
```
