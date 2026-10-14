# MaDo — Home Assistant AI Assistant

MaDo is a self-hostable AI assistant for Home Assistant with persistent memory, conversation history, device and sensor tools, and automation management.

## Features

- **Talk naturally to your home** through Home Assistant Assist or text.
- **Persistent memory** for preferences, routines, device nicknames, and sensor baselines. Memory is stored on your Home Assistant host.
- **Conversation history** across turns, with memory and history kept as separate features.
- **Home Assistant tools** for reading states, searching exposed entities, reviewing history, controlling devices, and creating or managing automations.
- **Confirmation before automation changes** so a preview is shown before an automation is applied.
- **Independent web search** using Mistral's native web_search. Add a Mistral API key in the add-on configuration to enable current web results with source URLs; without a key, MaDo continues to work for Home Assistant tasks without web search.
- **Bring your own model/provider** with Anthropic, Mistral, OpenAI-compatible endpoints, OpenRouter, or Ollama.
- **Voice and text** through Home Assistant Assist. Optional voice services depend on your chosen Home Assistant pipeline and configured providers.
- **A style for each kind of conversation**: spoken Assist answers in a sentence or two for text-to-speech, chat threads answer like a chat app (Markdown, code blocks with a copy button, long answers when needed). One shared persona (`custom_prompt`) plus optional per-style additions (`custom_prompt_voice`, `custom_prompt_thread`), and `assist_mode: voice` when you talk to Assist from the phone app.
- **Talk to a thread**: the 🎤 button records, transcribes with Mistral Voxtral and sends. On by default when a Mistral key is configured.
- **In the sidebar**: the chat panel appears in Home Assistant's sidebar on its own. To reach it from a dashboard, add a button card whose tap action navigates to the panel's address (open the panel and copy the path from the address bar).
- **Show it a photo**: in a chat thread, attach an image or take one with the phone's camera and ask about it (a plant, a label, an error on a screen). Needs a vision-capable model.
- **Charts and rich answers**: in a thread, MaDo draws line, bar and pie charts from real data (sensor history, consumption), with tooltips and a table view, and answers with Markdown tables, headings and lists.
- **Files in, files out**: attach any file to a thread (PDF, Word, Excel, PowerPoint, OpenDocument, text, ZIP…) and ask about it; ask for a document and MaDo writes it (Word, PDF, Excel, CSV, ZIP…) with a download link. Everything except PDF reading (Mistral OCR) happens on the add-on.
- **Mistral's own tools** (with a Mistral key): Python code interpreter for exact calculations and charts, image generation, PDF reading (OCR), search in your Mistral document libraries (`mistral_library_ids`), connectors to your Mistral-linked services (`mistral_connectors`, experimental), Voxtral voice (`text_to_speech: mistral`, 🔊 under each reply). Threads use Mistral Large 4's reasoning mode (`thread_reasoning`, default high).
- **Thread panel in the Home Assistant sidebar** (add-on ingress): separate conversations like a chat app. Each thread keeps its own conversation; what MaDo remembers about you (people, preferences, nicknames) is shared with Assist and every thread, or kept per thread with `thread_memory: isolated`. Assist keeps one conversation shared by all your devices (voice satellites, phone, laptop).

## Install

1. Add this repository to Home Assistant's add-on store.
2. Install the MaDo add-on and open its Configuration tab.
3. Configure your language-model provider and credentials.
4. Optionally set a Mistral API key to enable native web search.
5. Start the add-on, restart Home Assistant if prompted, then select MaDo as the Assist conversation agent.

## Web search setup

Enter a Mistral API key in the add-on option **Mistral API Key (Platform Tools)** (or use Mistral as your chat provider: its key is used when this one is empty). MaDo uses Mistral's built-in `web_search` through the Conversations API when the model requests the `web_search` tool. This is independent of the configured chat provider. Mistral returns findings and source references; treat web content as untrusted source material, not as instructions.

## Privacy

The memory database and conversation store remain on your Home Assistant machine. When using a hosted language model, the current request and relevant context are sent to that provider. When web search or another Mistral tool is used, its input (the query, the code task, the image description, an attached PDF) is sent to Mistral and the result is returned to MaDo; these calls are made with `store: false`. Review each provider's privacy terms before configuring it. For a fully local language model, configure a compatible local endpoint such as Ollama; web search remains an optional external service. Keep port 3100 unexposed (the add-on default): the thread panel authenticates through the Home Assistant login via ingress, and direct reachability of the server would bypass that.

## Version

Current release: **v0.7.0** (Mistral tools, charts and tables).

## License and upstream notices

MaDo is distributed under **GNU AGPL-3.0**. See [LICENSE](LICENSE) for the full license and all retained copyright and attribution notices from the upstream code. Those notices are preserved; this README describes the MaDo fork and its configuration.
