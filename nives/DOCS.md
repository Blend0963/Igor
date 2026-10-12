# MaDo

MaDo is an AI assistant for Home Assistant with persistent memory, conversation history, Home Assistant tools, automation management, and optional independent web search.

## Quick start

1. Install the MaDo add-on from this repository in Home Assistant.
2. In the add-on Configuration tab, set **LLM Mode** to **BYOK** and choose a supported provider.
3. Enter your provider API key, model, and optional base URL.
4. Optionally set **Web Search API Key** with a Tavily API key.
5. Start the add-on. Restart Home Assistant if prompted, then select **MaDo** as your Assist conversation agent.

## Language model providers

MaDo supports Anthropic, OpenAI, OpenRouter, and Ollama through its BYOK configuration. For OpenAI-compatible providers, use the provider's API key, model name, and base URL as applicable. For a local model, configure Ollama on a reachable host and use its OpenAI-compatible endpoint.

The model must support tool/function calling to control Home Assistant. Capabilities vary by model and provider.

## Web search

Web search is optional and independent from the language model provider. Create a key at [Tavily](https://tavily.com/) and enter it in **Web Search API Key**. MaDo invokes search when external/current information would help answer a question. Results include page titles, excerpts, and source URLs. Without a key, web search is disabled; Home Assistant tools, memory, and history continue to work normally.

Search queries are sent to Tavily when the tool is used. Search results are external content and may be inaccurate or malicious; MaDo treats them as source material rather than instructions.

## Memory and conversation history

MaDo stores its memory and conversation history on the Home Assistant host. Memory is used to recall durable preferences and facts across conversations; conversation history provides recent turn context. These are distinct features. When a hosted LLM is configured, the current request and relevant context are sent to that provider. For maximum local control, use a local model endpoint and disable web search if you do not want external search requests.

## Home Assistant tools and automations

MaDo can inspect entity states, search exposed entities, retrieve historical sensor data, call Home Assistant services, and create/list/edit/delete automations. Automation changes use a preview-and-confirm flow where supported. New automations are named with the **MaDo:** prefix.

Keep only the entities you intend the assistant to control exposed to Assist, and review automation previews before confirming.

## Voice

MaDo works as a Home Assistant Assist conversation agent. Speech-to-text and text-to-speech are configured through your Home Assistant pipeline or separately configured voice providers. Supported voice features depend on the chosen provider and model.

## Troubleshooting

- **Web search says it is not configured:** add a Tavily key to **Web Search API Key**, save, and restart the add-on.
- **Device controls do not work:** check that the selected model supports tool calling and that the target entities are exposed to Assist.
- **The assistant does not appear in Assist:** follow any restart-required notification or repair in Home Assistant.

## License and upstream notices

MaDo is distributed under **GNU AGPL-3.0**. See [LICENSE](../LICENSE) for the full license and retained upstream copyright and attribution notices.
