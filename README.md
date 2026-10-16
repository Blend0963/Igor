<p align="center"><img src="assets/brand/mado-logo.png" alt="MaDo" width="420"></p>

<p align="center"><b>The AI assistant that runs your home, inside Home Assistant.</b><br>
Talk to it, show it a photo, hand it a file: it answers, remembers and acts.</p>

---

MaDo is a Home Assistant add-on. It plugs into Assist (voice and text), adds a chat panel to the sidebar, and can be installed on your phone as an app. It controls your devices, reads your sensors and their history, writes and fixes your automations, reminds you of things and keeps an eye on the house, with a memory that stays on your Home Assistant machine.

## What it does

**Your home**
- Turns things on and off, opens, closes, sets, in any wording ("plonge la maison dans le noir"). Every order is checked: an answer that says "done" without acting is caught and redone.
- Knows what is on right now, the rooms and floors, and each device's capabilities.
- Reads sensor history and long-term statistics, and draws charts from them.
- Looks through your cameras ("qui est devant la porte ?").
- Creates, edits and deletes automations after showing a preview; reviews your automations, scripts and YAML files, and with your permission edits them (with a check and an automatic rollback).
- Asks before sensitive actions: unlocking, disarming an alarm, restarting Home Assistant.

**Your day**
- Reminders ("dans 5 minutes", "samedi à 15 h", "every Tuesday at 7 pm") and "tell me when the washing machine is done", sent to your phone or Telegram.
- An optional morning briefing and a house watch: leaks, smoke, windows left open, low batteries, failed automations, lights on while everyone is out.

**Conversations**
- Separate threads like a chat app, projects with their own instructions, search, export (PDF, Word, Markdown).
- Remembers your preferences, routines and nicknames; you can see and edit that memory.
- Files in and out: PDF, Word, Excel, PowerPoint, images, ZIP… Ask about them, or ask for a document and download it.
- Dictation (🎤), read-aloud replies (🔊), web search with sources.

**Models**
- Mistral (recommended: web search, code, image generation, OCR and voice come with the key), Anthropic, OpenAI, OpenRouter or a local model through Ollama.
- A cheaper fast model for plain commands, the main model for everything else, and a cost counter.

## Install

1. In Home Assistant: **Settings → Add-ons → Add-on store → ⋮ → Repositories**, add `https://github.com/Blend0963/MaDo`.
2. Install **MaDo**, open its **Configuration** tab, choose the provider and paste its API key.
3. Start the add-on. Restart Home Assistant when asked, then pick **MaDo** as the conversation agent of your Assist pipeline.

The full guide (options, reminders, YAML editing, installing the app on a phone) is in [nives/DOCS.md](nives/DOCS.md). What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Privacy and security

Memory, conversations and files stay on your Home Assistant machine. Only the current request and the context it needs go to the model provider you chose; with a local model, nothing leaves the house except optional web searches. The API is always protected by a key, the panel goes through the Home Assistant login, and actions that matter need your yes.

## License

MaDo is free software under the **GNU AGPL-3.0**, see [LICENSE](LICENSE). It started as a fork of Home Mind / Nives; the original copyright notice is kept in the license file, as the AGPL requires.
