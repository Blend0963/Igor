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
