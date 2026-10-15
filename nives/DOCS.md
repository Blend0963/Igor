# MaDo

MaDo is an AI assistant for Home Assistant with persistent memory, conversation history, Home Assistant tools, automation management, and optional independent web search.

## Quick start

1. Install the MaDo add-on from this repository in Home Assistant.
2. In the add-on Configuration tab, set **LLM Mode** to **BYOK** and choose a supported provider.
3. Enter your provider API key, model, and optional base URL.
4. Optionally set **Mistral API Key (Web Search)**.
5. Start the add-on. Restart Home Assistant if prompted, then select **MaDo** as your Assist conversation agent.

## Language model providers

MaDo supports Anthropic, OpenAI, OpenRouter, and Ollama through its BYOK configuration. For OpenAI-compatible providers, use the provider's API key, model name, and base URL as applicable. For a local model, configure Ollama on a reachable host and use its OpenAI-compatible endpoint.

The model must support tool/function calling to control Home Assistant. Capabilities vary by model and provider.

## Web search

Web search is optional and independent from the language model provider. Enter a Mistral API key in **Mistral API Key (Web Search)**. MaDo uses Mistral's native `web_search` tool through the Conversations API when external/current information would help answer a question. This key is separate from the selected chat provider. Without it, web search is disabled; Home Assistant tools, memory, and history continue to work normally.

Search queries are sent to Mistral when the tool is used. Search results are external content and may be inaccurate or malicious; MaDo treats them as source material rather than instructions.

## Memory and conversation history

MaDo stores its memory and conversation history on the Home Assistant host. Memory is used to recall durable preferences and facts across conversations; conversation history provides recent turn context. These are distinct features. When a hosted LLM is configured, the current request and relevant context are sent to that provider. For maximum local control, use a local model endpoint and disable web search if you do not want external search requests.

## Home Assistant tools and automations

MaDo can inspect entity states, search exposed entities, retrieve historical sensor data, call Home Assistant services, and create/list/edit/delete automations. Automation changes use a preview-and-confirm flow where supported. New automations are named with the **MaDo:** prefix.

Keep only the entities you intend the assistant to control exposed to Assist, and review automation previews before confirming.

## Voice

MaDo works as a Home Assistant Assist conversation agent. Speech-to-text and text-to-speech are configured through your Home Assistant pipeline or separately configured voice providers. Supported voice features depend on the chosen provider and model.

## Reminders, alerts and the house watch

Reminders and alerts go to the **Notification Service** option (for example `mobile_app_my_phone`), or appear as a notification inside Home Assistant when it is empty. The ⏰ button of the panel lists them and cancels them.

- **Reminders**: "remind me in 5 minutes", "tomorrow at 3 pm", "in 6 days at 6 pm", "every Tuesday at 7 pm". MaDo passes what you said and the add-on computes the date itself (time zone and daylight saving included), then repeats the exact date with its weekday. Reminders cost nothing when they fire.
- **When something happens**: "tell me when the washing machine is done" (its power below 5 W for 3 minutes), "tell me when someone gets home". Checked every 30 seconds, for free; dropped after 24 hours (up to a week) if it never happens.
- **House watch** (option **House Watch**, off by default): every 5 minutes plain checks look for water leaks, smoke, gas, a triggered alarm, doors and windows open for half an hour, a jammed lock, low batteries, devices that stopped answering, extreme temperatures, failed automations, and lights left on while everyone is out. Only something new is shown to the cheap model, which writes a short notification or decides it is normal (a freezer is cold). Safety alarms are always sent, even during the quiet hours; the rest waits for the end of the quiet hours and is capped per day. Alerts are also written into the "Veille de la maison" thread, where you can answer them. "on" watches the entities exposed to Assist; "all" the whole house (the watch only reports, it never acts).
- **Daily useful tip** (option **Daily Useful Tip Time**): once a day MaDo looks at the weather forecast and the house, and writes only when something is worth it, such as frost tonight with a window open.

## Reviewing your automations and configuration

In the panel or in written Assist, MaDo can read the full configuration of an automation, script or scene, the recent runs of your automations (which fail, which never run, which run too often), and the YAML files of your configuration folder (`configuration.yaml`, `packages/`, blueprints…). Ask "review my automations and tell me what could be improved". Reading is read-only: `secrets.yaml` is never read and values under keys such as `password`, `token` or `api_key` are masked. Changes go through the automation tools, which show a preview and wait for your confirmation; MaDo can also run Home Assistant's configuration check.

## Installed app (PWA) and sharing from the phone

The chat panel can also be installed as an app on a phone or a computer, outside Home Assistant. Installed, MaDo appears in Android's **Share** menu: a PDF, a photo, a Word or Excel file, a link or a piece of text shared to MaDo opens a new thread with it already attached, ready to send with a question.

Installing needs the panel served on its own HTTPS address, which Home Assistant ingress cannot give:

1. In the add-on's **Network** settings, give port 3100 a host port (for example 3100) and restart the add-on.
2. Put your reverse proxy (Nginx, Caddy, Traefik…) in front of it, on an HTTPS name of your choice, for example `https://mado.example.org/` → `http://<home-assistant-host>:3100/`. Replies stream as server-sent events: turn response buffering off for that location (Nginx: `proxy_buffering off;`, and a `proxy_read_timeout` of a few minutes). Allow request bodies of at least 80 MB (`client_max_body_size 80m;`) for attached files. The app can also live under a sub-path (`/mado/`) as long as the proxy strips it.
3. Open that address in the phone's browser and choose **Install app** (Chrome) or **Add to Home Screen** (Safari).
4. Outside Home Assistant there is no HA login in front of MaDo, so the server asks for its API key. Open the MaDo panel inside Home Assistant, tap 🔑: it shows the key with a **Copy** button. Paste it in the installed app's 🔑. The key gives full access to MaDo, and through it to your home: only publish the port behind HTTPS, and preferably behind your VPN or your proxy's own authentication.

Sharing files to MaDo works on Android (Chrome, Edge, Samsung Internet). iOS does not let web apps receive shares; there, open MaDo and use 📎.

## Troubleshooting

- **Web search says it is not configured:** add a Mistral key to **Mistral API Key (Web Search)**, save, and restart the add-on.
- **Device controls do not work:** check that the selected model supports tool calling and that the target entities are exposed to Assist.
- **The assistant does not appear in Assist:** follow any restart-required notification or repair in Home Assistant.

## License and upstream notices

MaDo is distributed under **GNU AGPL-3.0**. See [LICENSE](../LICENSE) for the full license and retained upstream copyright and attribution notices.
