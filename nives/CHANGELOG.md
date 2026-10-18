# Changelog

## 0.11.4 — A spoken answer that loops is cut short

- On a plain command ("mets un minuteur de 30 minutes") the fast model sometimes looped: it answered, added an emoji, then wrote "--- *Je corrige :*" and the same answer again and again, all of it read aloud and shown on the tablet. A spoken reply is now passed on sentence by sentence: a sentence it already said, or a "---" rule, ends it there, before any of the repeat is heard. Emojis are left out of spoken replies (the voice read their names). Written replies and threads are unchanged.
- **igor-ear** (since 0.11.3): "Igor" said alone gets a short spoken question ("Oui, monsieur ?", about seventy of them, never twice in a row), then the next sentence is the order, without the name. Igor no longer hears its own voice: the ear stays closed until its reply has played and the speakers are quiet, and a sentence that starts with what it just said is dropped. A second ear for the name, Vosk, runs next to Whisper; the names are configurable (`[name] names`, for instance `["mado", "igor"]`). `[mode] name_alone = "satellite"` hands the order to the satellite itself. On the hub: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## 0.11.4 — A spoken answer that loops is cut short

- On a plain command ("mets un minuteur de 30 minutes") the fast model sometimes looped: it answered, added an emoji, then wrote "--- *Je corrige :*" and the same answer again and again, all of it read aloud and shown on the tablet. A spoken reply is now passed on sentence by sentence: a sentence it already said, or a "---" rule, ends it there, before any of the repeat is heard. Emojis are left out of spoken replies (the voice read their names). Written replies and threads are unchanged.
- **igor-ear** (since 0.11.3): "Igor" said alone gets a short spoken question ("Oui, monsieur ?", about seventy of them, never twice in a row), then the next sentence is the order, without the name. Igor no longer hears its own voice: the ear stays closed until its reply has played and the speakers are quiet, and a sentence that starts with what it just said is dropped. A second ear for the name, Vosk, runs next to Whisper; the names are configurable (`[name] names`, for instance `["mado", "igor"]`). `[mode] name_alone = "satellite"` hands the order to the satellite itself. On the hub: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## 0.11.3 — "Igor" at the start or the end of the sentence

- "Igor" said first, then a short pause, was often lost by igor-ear: on its own the name lasts about a third of a second, and anything under 0.4 s was dropped as noise; the soft "I" was also cut by too short a lead-in. The minimum is now 0.25 s and 0.7 s before the voice is kept.
- "Éteins la lumière du salon… Igor": with a pause before the name, the order was a sentence already set aside. When the sentence just before (2 s at most) was a request and the one with the name holds none, igor-ear now sends both together.
- igor-ear gives the name a second chance: Whisper's small models often write it one letter off ("Igo", "Egor", "Igar"). Such a word at the start or the end of a sentence that is otherwise a request counts as "Igor"; "Hugo est passé hier" still does not.
- igor-ear brings a faint sentence up (to a peak of 0.6, at most 8 times) before transcribing it, so a voice from across the room is heard better without raising the microphone, which made close voices saturate.
- igor-ear can stay closed while the television or radio plays in the "name" mode too, not only the smart one: `[media] when_media = "closed"` (the sound settings move from `[smart]` to a new `[media]` section; the old place is still read). The answer to a question Igor has just asked is still heard.
- Igor is told that some voice requests come from an always-on microphone: the transcript can hold words said around the request, and it acts only on what is addressed to it.
- On the hub: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## 0.11.2 — The tablet shows when Igor waits for your answer

- When Igor asks a question ("Tous les volets, ou seulement ceux du salon ?"), igor-ear already took the answer without the name for 8 seconds, but nothing said so. The tablet now shows the bow tie with "Je vous écoute…" for that time, the question and answer kept in view, and closes when the window ends. The same after "Igor" said alone. The listening time is `[mode] followup_seconds` in igor-ear (default 8); the `nives.heard` service takes a new `seconds` field.
- **igor-ear, smart mode** (`[mode] addressing = "smart"`): requests said without "Igor" are taken too, when a small AI on the hub (qwen2.5:3b in Ollama, nothing leaves the house) judges, with the sentences heard just before, that they are for Igor. While a television or radio listed in `[smart] media_players` plays with sound, sentences without the name are not judged. `[smart] act = false` (the default) only notes what it would have done. See `ear/README.md`.
- Home Assistant needs one restart after this update. On the hub: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## 0.11.1 — The tablet shows at once that Igor heard you

- With igor-ear (no wake word), the wall tablet used to stay blank until the words had been transcribed and reached Igor, a few seconds after you stopped talking: you could not tell whether you had been heard. igor-ear now tells the integration the moment it hears "Igor" (new `nives.heard` service), and the tablet shows the bow tie with "Je vous ai entendu…" (or "Je vous écoute…" after the name alone). The **Igor Assist** sensor has a new state, `heard`, which goes back to idle after 30 seconds if nothing follows.
- igor-ear answers about a second sooner: a pause of 0.6 s now ends a sentence instead of 1.5 s (`[mode] join_gap`, raise it if you are cut off mid-sentence).
- Home Assistant needs one restart after this update to load the new integration files. On the hub: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## 0.11.0 — MaDo becomes Igor

- **MaDo is now called Igor**, with the tagline *In Igor we trust*. The name changes everywhere it shows: the add-on and its panel, the chat app, the integration and its entities' device, the default persona ("You are Igor"; a Custom Prompt you wrote yourself is left as it is), the notifications, the wall tablet, the logo, and the listener in `ear/`, now **igor-ear**, which answers to "Igor". The bow tie and the colours stay.
- What you built is kept. The add-on keeps its identifier and image, so it updates in place with its memory, threads and settings. Existing entity ids (such as `sensor.mado_assist`) stay; Home Assistant shows the new names. A wall tablet switched on with `?mado_tablet=1` keeps its display (the new switch is `?igor_tablet=1`). Automations made before carry "MaDo: " in their name; when Igor renames one, "Igor: " takes the old prefix's place.
- **igor-ear**: running `bash ~/MaDo/ear/install.sh` moves mado-ear's program, settings and notes over (nothing is downloaded again) and starts igor-ear in its place if mado-ear was running. A settings file that still says `hotwords = "MaDo"` is read as "Igor". Whisper now uses beam search on a GPU, which keeps the name it listens for (`[stt] beam_size`).
- Some voice satellites report "listening" all the time (for instance when the wake word is handled by Home Assistant, which keeps the audio streaming). The wall tablet then showed "Je vous écoute…" for good, and the listener, which stays quiet while the satellite is busy, never heard anything again. A state held longer than any real exchange (listening 30 s, processing 90 s, responding 3 min) is now taken as stuck and ignored, on the tablet and in igor-ear; a real new exchange is followed as before.
- Home Assistant needs one restart after this update to load the new integration files. The integration's entry keeps the title it was given ("MaDo"); rename it under Settings → Devices & services if you like.

## 0.10.6 — Requests in a satellite's name

- A request that reaches MaDo through the Assist pipeline with a voice satellite's device (as mado-ear does when it hears "MaDo" without the wake word, see `ear/`) is now treated like the satellite's own: MaDo answers in its spoken style, and the wall tablet shows the exchange. A phone, which also sends its device, keeps the written style.
- Home Assistant needs one restart after this update to load the new integration files.

## 0.10.5 — MaDo on the wall tablet

- **Voice requests on a wall tablet**: on a tablet that shows Home Assistant (Fully Kiosk Browser, the app or a browser), each request to a voice satellite is shown full screen, in MaDo's style. The screen dims and the bow tie flaps with "Je vous écoute…" at the wake word. Your words appear once transcribed, then the butler phrases and timer while MaDo works, then the answer word by word with its action chips. It fades back to the dashboard after the answer; a tap closes it. A question from MaDo keeps the exchange on screen while the satellite listens for your answer.
- Switched on per device by opening Home Assistant once with `?mado_tablet=1` (or `?mado_tablet=assist_satellite.x` for one satellite); other devices are untouched.
- New **MaDo Assist** sensor (idle, thinking, answering, done), fed by the integration during voice requests. Its texts are not recorded in the history and are cleared three minutes after the answer. The integration options can turn the sensor and the display off.
- Home Assistant needs one restart after this update to load the new integration files.

## 0.10.4 — A square logo

- In the logo, "MAJORDOME DOMOTIQUE" ran past the end of "MaDo" on the right. It now starts and ends exactly where "MaDo" and its rule do, so the wordmark reads as one square block.

## 0.10.3 — The butler at work

- **Nothing in the thread while MaDo works**: the waiting bubble with its bow tie is gone. MaDo's bubble appears with the first words of the answer; until then everything happens bottom left.
- **What MaDo is doing, in its own words, with the time spent**: the bow tie, a butler's phrase and a timer ("Je fais le tour des pièces… · 8 s", then "· 1 min 05 s"). The phrases follow the request (an order, a question about the house, history, a reminder, an automation, a camera, a document, a photo, a file to make, memory), then what MaDo does (thinking: "Je pèse le pour et le contre…") and how long it takes ("Cela demande un peu de soin…" after 30 s, "Merci de votre patience…" after a minute). They change every five seconds, never twice the same in a row, with a short fade (none when the device asks for reduced motion).
- The line goes as soon as MaDo writes, and comes back if it then goes on with tools; at the end only the tools line (when there is one) is left. "Réflexion…" and its bow tie no longer stay under an answer that used no tool.

## 0.10.2 — The bow tie at work

- **Tools line on one line**: after an answer, the tools it used are grouped and named in French ("Outils : liste d'entités ×50 · action ×2 · rappel") instead of one name per call; fifty `get_entities` calls no longer cover the screen. The status line never wraps.
- **Animations in MaDo's style** (off when the device asks for reduced motion): a bow tie flaps while MaDo thinks, in the status line and in the waiting bubble; the band's bow-tie pattern drifts slowly and the bow tie straightens itself when the panel opens; new messages slide in and action chips pop in one after the other; the welcome bow tie floats; buttons give a little press, and the stop button pulses while an answer is being written.

## 0.10.1 — Centred welcome

- On the welcome screen, "— Majordome domotique —" sat off to the right under the logo: it kept the band's alignment. It is centred now.

## 0.10.0 — MaDo, Majordome Domotique

- **New identity.** MaDo stands for *Majordome Domotique*, and its symbol is the butler's bow tie: a white bow tie with folds and a light-blue knot on Home Assistant blue, framed by a double fine line (solid, then dotted), with a small sparkle. It is used in the add-on store, the integration, the panel and the installed app, and the sidebar shows the matching built-in icon `mdi:bow-tie`.
- **Panel in Home Assistant's own colours**: HA blue (#03A9F4) and HA's light and dark backgrounds, with finishing touches: a faint bow-tie pattern and a fine inner line in the top band, "MaDo" in a serif wordmark (Caladea, bundled under the SIL Open Font License) with "— Majordome domotique", outlined chips and cards, a double-lined composer, a blue edge on the open thread, fine rules in the sidebar. Light and dark still follow the device.
- **Renaming a thread on the phone**: the pencil next to each thread was hidden on touch screens (only the star and the cross showed). It is visible again, and the thread name in the top band shows a small pencil: tap it to rename.
- The custom `mado:` icon set of 0.9.8–0.9.9 never showed in the sidebar on a real Home Assistant; it is removed, and the integration no longer loads a script on every Home Assistant page.

## 0.9.9 — The sidebar icon shows up

- In 0.9.8 the sidebar could draw MaDo's entry before the icon set was loaded, and the icon then stayed empty. The icon set now redraws every `mado:` icon already on the page once it has loaded, and after each navigation.

## 0.9.8 — MaDo's icon in the sidebar

- The sidebar shows MaDo's own icon (the leaning house with its small network) instead of the generic brain. The companion integration registers an icon set `mado:` with Home Assistant's frontend, so `mado:logo` can also be used anywhere Home Assistant asks for an icon (dashboards, buttons). Right after a restart the icon can take a moment to appear, until the integration has loaded.

## 0.9.7 — The MaDo look in the panel

- **New panel theme**: a Home Assistant blue band at the top with "MaDo" in italics and the thread's name, white cards for MaDo's answers, blue bubbles for yours, rounded composer. **Light and dark follow the phone or computer** automatically. Same look on the phone and the laptop (thread list on the side).
- **Drawn icons everywhere instead of emojis**: composer (attach, photo, microphone, send / stop), header, sidebar tools, favourites, rename and delete, file links and attachments, chart enlarge, window titles, memory, reminders and diagnostic lists.
- **Copy button on every bubble**, yours and MaDo's, next to read aloud, edit and regenerate.
- **Action chips**: above an answer, what MaDo really did in the house: "Salon · éteint", "Volet · fermé", "Rappel · samedi 18 octobre à 07:00", "Volets du soir · créée". They come from the actions Home Assistant confirmed, never from the model's words, and stay with the message.

## 0.9.6 — MaDo's own look

- **New icon and logo**: a house with a small neural network inside, in Home Assistant blue, with "MaDo" in white italics. In the add-on store, the integration, the sidebar panel and the installed app.
- **Messages from the previous project removed**: when the AI provider has no credit left, MaDo now says so plainly (in French when you speak French) instead of pointing to a top-up site that has nothing to do with MaDo.
- New README and license header. The inherited code keeps its original copyright notice, as the AGPL requires.

## 0.9.5 — Orders recognised whatever the wording, and the real state in view

- **The live state of the house goes with every message.** Before each turn MaDo reads Home Assistant and hands the model the list of what is on, open or running right now (lights, switches, fans, covers, unlocked locks, media players, climate, vacuums). The model no longer takes its own earlier reply for the truth: "elles sont déjà éteintes" while the salon is lit is gone. The list is told to change nothing by itself: acting still takes a tool call. About a hundred tokens per message, placed after the history so the prompt cache is kept.
- **Orders are recognised by meaning, not by a word list.** 0.9.4 caught only orders opening with their verb ("éteins…"). Now an order verb anywhere counts ("je te demandais d'éteindre…", "ferme-les", "coupe la lumière"), and any other short message whose answer called no tool is checked by the fast model (or the main one): "was this a request to change something in the home?". If yes, the answer is held back and the order asked again on the main model with a tool call required, so "plonge la maison dans le noir" is carried out too. The check runs alongside the answer, so it adds no wait when the answer acted anyway, and a "no" releases the answer as soon as it is known.

## 0.9.4 — Orders are carried out, not just answered

- A plain order ("éteins toutes les lumières") answered without calling any tool did nothing, whatever the reply said: the fast model sometimes just replied "la lumière est éteinte". Such a reply is now held back, never spoken, and the order is asked again on the main model with a tool call required. If the provider refuses that, the first answer is kept as before.

## 0.9.3 — Security fixes

From a full security audit of the add-on. No backdoor was found; these close the weaknesses it did find.

- **API authentication always on.** The token used to be required only once the companion integration had confirmed it held it; until then (first start, after an update or a token rotation) the whole API was open to every other add-on, and to the internet if port 3100 was published. Now only Home Assistant Core may call without the token during that handoff. Requests are read only after authentication (1 MB at most outside the chat), and an address that keeps sending wrong tokens is shut out for 15 minutes.
- **Panel: files from replies can no longer run.** An HTML or SVG file made by a tool and shown as an image could run in the panel, which under Home Assistant shares HA's origin (and its session). Only real images are shown now; anything else is a download. The panel also gets a Content-Security-Policy.
- **Nobody there, no confirmation.** Scheduled tasks, the morning briefing and AI Task requests could preview a change in one run and "confirm" it in the next. They no longer get any tool that needs a person (automations, YAML writes, forgetting, scheduling, connectors). A retried change after a failed apply is only allowed for 2 minutes.
- **Sensitive actions need a yes:** unlocking or opening a lock, disarming an alarm, restarting Home Assistant, ADB commands, shell_command / python_script / pyscript / rest_command, recorder purges. Refused outright when nobody can confirm.
- **New option `config_edits`:** `off` (read only), `automations` (default) or `yaml`. Writing YAML files is now off unless you choose `yaml`.
- **YAML writes cannot add** shell_command, command_line, python_script, pyscript, rest_command, hassio actions, homeassistant.stop or login/proxy/file-access settings; a symlinked folder can no longer lead a write outside /config; secrets in multi-line values, lists and `{key: value}` maps are masked too.
- **Files:** an archive shares one 60 MB unpacking budget with everything inside it (no more nested zip bombs); a PDF is read for 20 seconds at most; two files are read at a time; a document's text cannot close its own block to pose as your words; generated spreadsheets keep formulas but not ones that reach outside (HYPERLINK, WEBSERVICE…), and CSV cells cannot start a formula.
- **Add-on:** `auth_api` removed (unused); Node.js is copied from the build image instead of a `curl | bash` installer; every downloaded file (Shodh, ONNX Runtime, the MiniLM model, s6-overlay, bashio) is checked against a pinned SHA-256; the integration is reinstalled whenever its installed files differ from what ships (not only on a version change), and replaced wholesale; base images are pinned by digest and the GitHub Actions by commit SHA (Dependabot keeps them current); a published image version is never overwritten; production mode, no stack traces; a debug line that printed environment variables is gone; the upstream project's referer headers are no longer sent to the AI provider.
- **The API token no longer sits in the config folder.** The integration now keeps the token in its own configuration and says so in its receipt; the add-on then deletes `/config/nives/.api_token` (it is written again only when a new token must be handed over).
- **New option `rotate_api_token`:** turn it on and restart the add-on to replace the token; it switches itself back off. Home Assistant Core keeps working with the old token until its next restart.
- `/api/admin/conversations` answers only the panel inside Home Assistant; text-to-speech is capped at 6000 characters; a newer request on a thread stops the one it supersedes.

## 0.9.2 — MaDo can edit your YAML

- write_config_file: MaDo can change the YAML of the configuration folder (scripts.yaml, configuration.yaml, packages…; never secrets.yaml). It shows the exact lines removed and added and writes only after your yes, what was shown and nothing else; a backup copy is offered, never required; Home Assistant's configuration check runs after the write and the previous content is put back if it fails; scripts, automations and scenes are reloaded. Masked secret values are restored from the file, and a file changed in the meantime is not overwritten.

## 0.9.1 — Notifications through Telegram

- The notification service option also takes a notify entity (`notify.telegram_bot_…`, what a Telegram bot set up from the UI creates) and `telegram_bot` / `telegram_bot:<chat id>`, besides notify services (`mobile_app_…`, `telegram`). A name that is neither a service nor an entity is reported instead of failing silently.
- Requests for reminders, timers and alerts ("mets-moi un rappel…", "lance un minuteur…") always go to the main model, never to the fast model, so the reminder is actually scheduled.

## 0.9.0 — Reminders on time, the house watch, reviewing automations

- Reminders: "dans 5 minutes", "demain à 15h", "dans 6 jours à 18h" are computed by the add-on (time zone and clock changes included), not by the model, and MaDo repeats the exact date with its weekday.
- notify_when: "préviens-moi quand la machine à laver a fini" or "quand quelqu'un rentre" watches an entity and notifies once (checked every 30 s, free).
- send_notification: MaDo can send something to your phone when you ask.
- House watch (option `house_watch`, off by default): plain checks every 5 minutes (leak, smoke, gas, alarm, doors and windows left open, jammed lock, low batteries, devices gone, extreme temperatures, failed automations, lights on with everyone out); only new findings go to the cheap model, which writes the notification or stays quiet. Quiet hours, daily cap, safety alarms always sent; alerts kept in the "Veille de la maison" thread. Optional daily useful tip (`watch_lively_time`).
- Dictation in the panel: ⏹ now puts the transcription in the message box to be read over and sent; ↑ while recording stops, transcribes and sends at once.
- Reviewing the configuration: get_config_item (an automation's, script's or scene's full config), get_automation_traces (recent runs, failures), read_config_file (YAML of the configuration folder, read-only, secrets masked), check_ha_config.

## 0.8.4 — Installable app, share to MaDo

- The chat panel is installable as an app (PWA): manifest, icons and a service worker. Served on its own HTTPS address through your reverse proxy, it installs from the browser and opens full screen, without Home Assistant around it. See "Installed app (PWA)" in the documentation.
- On Android, the installed app is in the **Share** menu: files (PDF, photos, Word, Excel, PowerPoint, OpenDocument, zip, text), links and text shared to MaDo open a new thread with them attached.
- 🔑 in the panel inside Home Assistant shows the API key to copy into the installed app.

## 0.8.3 — Charts and tables full screen

- ⛶ on a chart or a table of a reply opens it full screen. Charts are redrawn at the size of the screen (tall on a phone held upright, wide on a computer, again when the phone turns) with text at its normal size; ✕, Échap or a tap outside closes it.

## 0.8.2 — A cleaner message box

- The chat panel's message box is one rounded card: the text on top, and below it 📎, 📷, the model and thinking pickers as compact pills sized to their choice, 🎤 and a round send button (■ red while MaDo answers). It fits on one line on a phone too. The 🎤 no longer shows when speech-to-text is off.

## 0.8.1 — Model and thinking pickers, options in French

- Chat panel: two pickers above the message box choose, for each thread, the model (every chat model of your Mistral account, or "auto" for the add-on settings) and how much it thinks before answering. A new thread starts from the last choice; Assist keeps the add-on settings.
- Every option of the add-on is now explained in French when Home Assistant is set to French (`translations/fr.yaml`).

## 0.8.0 — Control, savings and a smarter home

- **Stop button**: while MaDo answers, Envoyer becomes ■ Arrêter. The model call is really cut (no more tokens billed) and what was already written stays in the thread, marked as interrupted.
- **Fast model for simple commands** (`fast_model`): plain commands and quick state questions go to a cheaper model without reasoning; everything else stays on the main model, and a failing fast model falls back to it.
- **Cameras**: "qu'est-ce qu'il y a devant la porte ?" — MaDo takes a snapshot from a Home Assistant camera (exposed to Assist), looks at it and answers; in a thread the picture is shown too.
- **Reminders and scheduled tasks**: "rappelle-moi de sortir les poubelles mardi à 19 h" (a notification, free), "chaque dimanche à 18 h, fais le bilan énergie de la semaine" (MaDo runs the request and sends the answer). Listed and cancelled from ⏰ in the panel or by asking. Sent to `notify_service` (your phone) or as a Home Assistant notification.
- **Morning briefing** (`daily_briefing_time`, `daily_briefing_prompt`): every day, weather, indoor temperatures, yesterday's consumption and anything unusual, as a notification and in a "Résumé du matin" thread.
- **Long-term statistics**: comparisons over months or years ("ma conso d'octobre par rapport à l'an dernier") from Home Assistant's statistics, much cheaper in tokens than raw history.
- **Panel**: 🧠 memory page (see, correct, add, forget what MaDo remembers), search across threads, edit the last question and regenerate the last answer, export a thread as PDF, Word or Markdown, and projects (📂 groups of threads with their own instructions).
- **💶 Cost counter**: estimated cost per day, per thread and per model over 30 days, from the tokens actually used (prices adjustable with `model_prices`).
- **🩺 Diagnostic**: checks Home Assistant, the memory, the Mistral key and the configured model names for free; optionally tests OCR and the voice (about 0.01 $).

## 0.7.1 — Titled threads, replies that survive leaving the page

- New threads get a real title from their first message ("Rempotage du ficus" rather than the first words of the question), written by a small call on the memory-extraction model (`extraction_model` when set) while the reply streams. Renaming a thread still wins, and later messages never change its title.
- A reply goes on when you leave the panel (another Home Assistant page, the phone app in the background): it always did on the server, but the panel lost it and showed the question unanswered until the next visit. The thread list now shows animated dots on every thread still being answered, and opening one follows the reply as it is written until it is stored.

## 0.7.0 — Mistral's tools, charts and tables

Mistral's own tools need a Mistral key: the dedicated one, or your chat key when the provider is Mistral. Charts, file reading (except PDFs) and file creation work without one.

- Charts in the chat panel: MaDo draws line, bar and pie charts from real data (a sensor's history, consumption per day…) right in its answer, with a legend, a tooltip on every point and a "Tableau" button that shows the numbers. Answers also render full Markdown: tables, headings, lists, quotes, links.
- Threads think before answering: Mistral Large 4's reasoning mode, "high" by default (new option `thread_reasoning`; "none" turns it off). "Réflexion…" shows while it thinks. Spoken Assist never thinks first, and the reasoning is never shown in the answer.
- New tools in threads: `run_code` (Python in Mistral's sandbox: exact calculations, statistics, charts as images) and `generate_image` (illustrations). Generated images are kept with the thread (in `/data/media`, the 500 most recent) and shown in the answer.
- Any file: 📎 now accepts every kind of file (up to 5 per message, 10 MB each), shown as a 📄 chip. Word, Excel (every sheet), PowerPoint, OpenDocument, text formats (CSV, JSON, Markdown, code…), PDFs that contain text and ZIP archives (with the files inside them) are read on the add-on itself, at no cost but the tokens of their text. Only a scanned PDF (pages that are pictures of text) needs Mistral OCR, billed per page: MaDo then stops and shows the page count and an estimated price ("≈ 0,048 $ for 12 pages"), and reads it only if you accept; "Envoyer sans le lire" sends the message without it. New option `ocr_price_per_1000_pages` (default 4 USD) for that estimate. A file's text is capped at 40,000 characters, and past the last 6 messages of a thread only its opening is re-sent with the history, so a document attached long ago stops costing tokens on every turn.
- MaDo creates files: Word (docx), PDF, Excel (xlsx, several sheets, formulas), CSV, Markdown, text, JSON, HTML, XML, calendar (ics), and ZIP archives of them, built on the add-on (no Mistral key needed). The answer carries a download link.
- `search_documents`: answers from your own documents in a Mistral library (manuals, invoices, contracts), in Assist and in threads. New option `mistral_library_ids`.
- `use_connector` (experimental): reaches the connectors set up in your Mistral account (mail, calendar, notes…) from a thread, asking before anything that sends, books or deletes. New option `mistral_connectors`.
- Favourite threads: ☆ on a thread in the list marks it as a favourite (★); favourites stay at the top of the list under their own heading.
- Voxtral voice: new option `text_to_speech: mistral` (and `tts_voice`) adds a 🔊 button under each reply in the panel and offers MaDo as a text-to-speech engine to Home Assistant's voice assistants.
- Memory extraction on Mistral uses JSON mode, so a fact is never lost to a reply that is not valid JSON.


## 0.6.0 — One memory for Assist and the threads

- What MaDo remembers about you is now shared between Assist and the chat-panel threads: tell the voice assistant who someone is, and a thread knows it, and the other way round. Each thread still keeps its own conversation; other threads and Assist conversations are never mixed into its history or its recall.
- New option `thread_memory`: `shared` (default) or `isolated`, which keeps the previous behaviour of one memory per thread. Facts that threads learned in isolated mode stay in their own memory and are not moved; they are removed when the thread is deleted.

## 0.5.1 — Voice answers no longer run out of room

- Fix spoken (and `assist_mode: voice`) answers ending in "MaDo ran out of room before it could write the answer": a reasoning model such as Mistral Large 4 spent the whole 500-token voice ceiling thinking, even on "who are you?". Voice turns now send `reasoning_effort: none` unless `reasoning_effort` is set in the add-on (an answer read out loud is wanted at once, and thinking is billed as output), and the voice ceiling is 2000 instead of 500. The ceiling is not a reservation: a short answer still costs only its own tokens, and the voice prompt is what keeps replies short.

## 0.5.0 — Fewer tokens per request

Every request re-sends its whole context on every model call of its tool loop, so whatever the context carries is paid several times. This release trims what it carries.

- Mistral prompt cache: requests now carry a stable `prompt_cache_key` (one per conversation style and memory bucket), which Mistral needs before it bills the repeated opening of the prompt (persona, instructions, tools, home layout, about 10k tokens) at its cached rate. If Mistral refuses the parameter, the call is retried once without it and the key is not sent again.
- Tool results are compact: no JSON indentation, and entity states lose what only Home Assistant's UI uses (icons, effect and source lists, the same colour in three colour spaces). A WLED strip goes from about 1,500 tokens to about 60. search_entities and get_entities return at most 25 entities and tell the model to narrow the query past that. Service responses (a script's output) pass through whole.
- Memory extraction sees the 25 existing facts closest to the turn instead of the whole bucket (up to 100, with ids), as compact JSON.
- Assist sends its last 12 messages instead of 20 (threads keep 20); semantic recall brings back 4 older messages instead of 6, never one that is already in the history.
- Remembered facts: 1,500 tokens per request instead of 3,000, most relevant first. New option `memory_token_limit` to change it.
- Photos from the panel are sent at 1024 px instead of 1600 (about 2,700 image tokens instead of 6,700).
- One `[usage]` line per request in the add-on log: model calls, prompt, cached and completion tokens summed over the whole tool loop, so the effect of each setting can be measured.

## 0.4.2 — The thread list on a phone

- On a phone the thread list could not be reached before a thread was open: the ☰ button lived in the conversation header, and the welcome screen had none. The header is now always there, with ☰ to show the list and ＋ for a new thread; the list opens by itself when the panel starts on a phone, and tapping the dimmed background or ✕ puts it away. Desktop is unchanged.

## 0.4.1 — A real viewfinder

- The 📷 button opens a viewfinder inside the chat panel (live preview, shutter, front/back switch) instead of a file picker. The `capture` hint it relied on is ignored by desktop browsers and some app webviews, which showed the same picker as 📎. The photo is taken at up to 1600 px and lands in the message like an attachment. Where the camera cannot be opened (permission refused, no camera), the file picker remains the fallback. The camera stops as soon as the photo is taken, the viewfinder is closed, or the app goes to the background.

## 0.4.0 — A prompt for each kind of conversation

- Three conversation styles instead of two. Voice Assist stays short and spoken, typed Assist stays plain text, and chat-panel threads get their own built-in instructions: a general-purpose assistant that still runs the home, with Markdown, code blocks and answers as long as the question needs.
- New add-on options `custom_prompt_voice` and `custom_prompt_thread`, appended to `custom_prompt` for that kind of conversation only, so shared rules (identity, contacts, confirmations) are written once and only the style differs. Existing installs keep exactly the persona they had.
- New option `assist_mode` (`auto` / `voice` / `text`). Home Assistant only marks satellite requests as spoken, so voice from the phone app used to get the typed style; `voice` treats every Assist request as spoken. Threads are never affected.
- When a custom persona is set, the built-in instructions now say that it wins on style (length, tone, language, preambles, what needs a confirmation), except for the confirm-first flows the tools enforce and honesty about what actually happened.
- Voice replies no longer read web addresses aloud: sources are named instead of linked.
- The built-in instructions' examples are now French instead of Slovenian (inherited from the upstream project).
- Images in chat threads: attach with 📎, take a photo with 📷 (opens the phone's camera in the Home Assistant app), paste, or drop onto the panel, then ask about it, or send the photo alone for "what is this?". Photos are shrunk to 1600 px JPEG in the browser before they leave. Images go to the model with the message but are not stored: the thread remembers what MaDo said about them. Needs a vision-capable model (Mistral Large/Medium/Small 3+, Claude, GPT-4o…).
- Mistral receives images in its documented form (`image_url` as a plain string); other providers keep the OpenAI form with `detail: "low"`. Images must be JPEG/PNG/WebP/GIF data URLs or https links.
- Rename a thread: ✎ next to it in the sidebar, or click its title. Names are kept server-side (`PATCH /api/conversations/:userId/:conversationId`) and removed with the thread.
- Microphone in chat threads (🎤): speak, tap ⏹, and the transcript is sent like a typed message (or added to what you were typing). Recorded in the browser, converted to 16 kHz WAV, transcribed by Mistral's Voxtral. New option `speech_to_text` (`auto` / `off`): on by default whenever a Mistral key is available (the web-search key, or the chat key with the Mistral provider). The button only shows when transcription is on; where the browser cannot record, the phone's recorder opens instead. With transcription on, MaDo also appears as a speech-to-text engine in Home Assistant's voice assistant settings.
- The chat panel is added to the Home Assistant sidebar automatically, once, on the first start of this version (Supervisor leaves "Show in sidebar" off for ingress add-ons). Switching it off again sticks.
- Fix the empty bubble above every answer in the panel: the server opens each model turn, the first one included, and the panel opened a new bubble for each. Errors now show in the answer bubble instead of an empty one.

## 0.3.2 — Code blocks with a copy button

- The thread panel shows code in assistant replies the way chat apps do: each ``` fenced block gets its own box with the language and a "Copier" button, and `inline code` is set in monospace. Rendering is built from DOM text nodes only, so a reply can never inject markup, and a block still being streamed already shows as code. The copy falls back to a textarea copy where Home Assistant's ingress frame refuses the clipboard API. Assist and voice are unchanged.

## 0.3.1 — Threads answer again

- Fix every panel thread failing with "Aucune réponse du serveur": a thread's memory bucket was named `<user>@mado-thread:<id>`, and Shodh rejects the `:` in a user_id (400 INVALID_INPUT). The bucket is now `<user>@mado-thread.<id>`, using only the characters Shodh accepts. Assist was not affected.

## 0.3.0 — Sealed threads, security hardening

- Panel threads are now fully sealed off. Each thread has its own long-term memory (facts learned there stay there), its semantic recall only searches that thread, and `forget_memory` only touches it; nothing from Assist or from the other threads reaches it, and nothing learned in a thread reaches them. Assist keeps one memory shared by every device. Before, only the short-term history was separate: facts and recall leaked both ways.
- Threads keep up to 500 messages instead of 20, so a long thread no longer forgets its own beginning; deleting a thread also deletes everything it memorised.

- Trust the ingress user header only from the Supervisor's ingress proxy (172.30.32.2). Port 3100 is unexposed on the host, but every other add-on on the hassio network could reach it and set X-Remote-User-Id itself, which skipped the API token entirely (0.2.1 regression).
- Validate every model-supplied id that ends up in a Home Assistant URL path (entity_id, service domain and name, automation config id). The base URL is http://supervisor/core, so an id with `..` segments carried the add-on's Supervisor token to the Supervisor API.
- Refuse the `hassio` domain and `homeassistant.stop`, from call_service and from automations the assistant writes (templated names included): the model reads untrusted web results and entity names, which must never be able to stop add-ons, write to their stdin, restore backups or shut the host down.
- A conversation id no longer opens another user's thread: history, the conversation endpoint and thread deletion only see the requesting user's own messages.
- Cap the size of chat requests (message, ids, custom prompt, image count), add `nosniff` / `no-referrer` headers and drop `X-Powered-By`, and create the add-on's secret files owner-only from the start.

## 0.2.2 — Threads actually get their own history

- Fix the empty thread sidebar: both chat engines (Anthropic and OpenAI-compatible) overrode the conversation id from the request with the shared Assist conversation, so panel messages were stored in the Assist history and no thread ever appeared.
- Honor only the mado-thread: prefix: thread ids coming from the panel get their own conversation, while Assist keeps the single shared conversation as before (Assist sends its own per-chat-log id, which must not fragment the shared history).
- Threads keep the rolling 20-message ceiling and stay exempt from the 24-hour cleanup; long-term memory remains shared across threads and Assist.

## 0.2.1 — The panel under ingress, without the API key

- Accept Home Assistant ingress requests in the API token middleware: the Supervisor stamps X-Remote-User-Id on the requests it proxies after the Home Assistant login, so the thread panel no longer shows the API key dialog behind ingress when token enforcement is on.
- Direct callers are unchanged: they still need the bearer token, and the add-on port stays unexposed by default, which is what keeps the ingress header trust sound.

## 0.2.0 — Thread panel

- Add a built-in multi-thread chat panel served by the add-on over Home Assistant ingress: create, open, and delete separate conversation threads like a chat app. The panel appears in the Home Assistant sidebar behind the Home Assistant login; the raw port 3100 stays unexposed by default.
- Segment short-term memory per thread: each web thread is its own conversation, while the shared Assist conversation is untouched. Long-term memory stays shared across all threads and Assist.
- Give conversations a sidebar title derived from the first user message, so threads are recognizable at a glance.
- Exempt web threads from the 24-hour conversation cleanup: only the shared Assist conversation keeps every message, while threads keep the rolling 20-message window.

## 0.1.5 — Timestamps are metadata, not speech

- Time-mark only the user's past messages in the conversation history; the assistant's own replies are sent unstamped, because stamped replies taught the model to open answers with "[09:12]".
- State explicitly in the written and voice system prompts, and in the semantic-recall header, that time markers are metadata about when something was said — never to be copied into a reply.

## 0.1.4 — Memory is not the present

- Timestamp every conversation-history message and every semantically recalled message sent to the model, so memories read as past events rather than the current state of the home.
- Add "MEMORY IS NOT THE PRESENT" rules to the written and voice system prompts: never assert device state from a memory, verify the live state with get_state / search_entities, and treat "do it again" as a fresh command to execute now.
- Recognize French transient-state and command-echo statements ("a été allumée", "actuellement", "vient d'être éteinte") as garbage facts; the periodic cleanup job purges them retroactively.

## 0.1.3 — Mistral BYOK chat provider

- Add `mistral` to the add-on's bring-your-own-key provider choices (port of upstream Nives PR #107).
- Map Mistral chat to the OpenAI-compatible client: official `https://api.mistral.ai/v1` endpoint with `mistral-small-latest` as the default model.
- Omit `stream_options` for Mistral, which rejects that OpenAI-specific request field.
- Treat HTTP 422 reasoning-parameter validation errors as unsupported and withhold non-`none` Thinking Effort values from Mistral endpoints.

## 0.1.1 – 0.1.2 — Shared conversation and Mistral content fixes

- Use one persistent conversation across Assist devices and days, with semantic recall (embeddings and cosine similarity) of older stored history (#2).
- Handle structured content blocks in streamed model responses and normalize them during fact extraction (#3).

## 0.1.0 — MaDo initial release

- Establish MaDo branding and Home Assistant add-on metadata.
- Default new installations to bring-your-own-key model configuration.
- Add optional Mistral native web search with source URLs and excerpts.
- Preserve Home Assistant tools, automation confirmation flow, persistent memory, and conversation history.
- Retain the AGPL-3.0 license and upstream copyright/attribution notices.
