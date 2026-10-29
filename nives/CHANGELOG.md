# Changelog

## 0.18.1 — Expose everything, the training set sorts it out

- The training set now leaves out what nobody says out loud, even when everything is exposed to Assist: what Home Assistant's entity registry marks as diagnostic or configuration, hidden entities, and what reads like it (batteries, signal, firmware, uptime, indicator lights, child locks, calibration…). The add-on log says how many were left out.
- Groups: when a group ("Lumières salon") and its bulbs are in the same room, "la lumière du salon" and "éteins tout dans le salon" now mean the group, and each bulb keeps its own name. A group with no room takes its members' room. Before, a room with several lights got no short phrasing at all.

## 0.18.0 — A training set for a local model that knows the house

- The panel's Diagnostic page downloads a training set built from your house (`igor-local-dataset.zip`): a few thousand requests in French, each one exactly as Igor sends it to the local model, with the answer it should give. They cover orders (lights, brightness, white and colours as each light takes them, covers, heating, media, scenes, scripts, locks, vacuum), questions about a state, reminders and alerts, contacts, memories, follow-ups ("et la cuisine ?", "vas-y"), devices the house does not have, and "-" for everything that is not about the home. A held-out part (`test.jsonl`), phrased in ways training never sees, is for checking the trained model. The file describes your house: it stays with you.
- New option `local_llm_tuned`: for a local model fine-tuned on that set. Its prompt leaves out the room map and the light cheat sheet, which it has learned, so it is shorter and faster to read. Off by default.

## 0.17.0 — The local model acts, Mistral speaks only when there is something to say

- With the local model, a plain order whose outcome Home Assistant reports (lights, covers, thermostats, reminders) no longer calls Mistral: Igor says the short sentence built from the new states ("Lumière salon allumée.") at once, or nothing. Questions, general knowledge, news, web searches and scripts still go to Mistral, which answers.
- New option `local_order_reply`: `sentence` (default, the short sentence), `silent` (the order is carried out without a word) or `online` (Mistral words it, as in 0.16).

## 0.16.6 — Covers: turn_on and turn_off too

- "Ferme-les complètement" asked for cover `turn_off`, which Home Assistant refuses; it is now sent as `close_cover` (and `turn_on` as `open_cover`).
- `ear/tools/stt-bridge`: Whisper now gets the house's usual words as its initial prompt, which steers short commands ("ferme-les complètement" was heard as "ferme le lit complètement"). Run its install.sh again on the VM to apply.

## 0.16.5 — Service names fixed before Home Assistant sees them

- "Ouvre les volets à 10 %" failed: the model asked for cover `set_position` and `open`, which Home Assistant refuses (the real services are `set_cover_position` and `open_cover`). The server now maps such near-miss names to the real ones (covers, media players, thermostats, fans, lights, switches) before calling Home Assistant; a real service is never changed. This helps every model, local or online.
- With the local model, Mistral now always searches the web for results, prices, elections, releases and anything that changes over time, even when it thinks it knows: it had answered "who won the Ballon d'Or" from memory.

## 0.16.4 — The local model reads less at each request

- The local model now reads only the last exchange (enough for "vas-y" or "et la cuisine ?") instead of six messages, and today's date instead of the time to the minute: the part of its prompt it reads again at each request shrinks from about 450 to about 150 tokens, and the once-a-minute prewarm no longer has anything to read. Mistral, which answers, still gets the last six messages and the exact time.

## 0.16.3 — Mistral knows today's date

- With the local model, Mistral answered without knowing today's date: asked who won the Ballon d'Or "cette année", it searched the web for the wrong year and answered wrongly. It now gets the date and time with every request, and searches again when asked to check.

## 0.16.2 — Mistral searches the web itself

- With the local model, "qui a gagné le Ballon d'Or en 2026 ?" got "I don't have that information": the local model saw nothing about the house in it and did not search, and Mistral answered from what it knew. Mistral now runs the web search itself whenever its knowledge is not enough (news, anything recent), and never says it does not know without searching. Only the query leaves, as before. The local model no longer has the web search.
- The "was this said to Igor?" check (a sentence that names Igor in the middle) now runs on Mistral, which receives the sentence anyway: about half a second instead of up to 4 seconds while the local model was busy.

## 0.16.1 — The local model reads less

- A web search, a state read, a contact search, a reminder or an order now goes straight to Mistral with its results: the local model no longer reads them again first. A web search's results took it so long that no answer came. It reads results again only when a second action depends on them (a device search before the order, the calendar's date conversion).
- The list of what is on is no longer in the local model's prompt: it changed all the time and had to be read again at every request and every minute (about 650 tokens, 8 to 12 seconds). The local model reads a state when a request needs it.
- A request no longer waits behind a prewarm under way: the prewarm is stopped.
- The `[usage]` line names both models: the local one that acts and Mistral that answers.

## 0.16.0 — With the local model, Mistral answers everything

- The local model never speaks any more. It only acts and reads (turn on, read a temperature, find a contact, schedule a reminder), and writes a single "-" when nothing at home is concerned, which takes it a fraction of a second.
- Mistral Large then answers every request as Igor, from your exact sentence, the last exchanges (so "vas-y, allume" or "et la cuisine ?" are understood) and what the local model did or read for this request. It never receives the house's layout, the state of everything that is on, your memory or your contact list.
- A plain order no longer needs a second pass on the local model: once Home Assistant reports what changed, Mistral answers at once (the plain sentence, "Lumière salon allumée.", if it takes more than 4 seconds).
- **Memories**: Mistral does not see what Igor remembers. When an answer depends on it ("comment je m'appelle ?", a preference, a habit), the local model hands over just those memories with a new tool, and the server checks that each one is a memory Igor really holds before it leaves; anything else is dropped.
- The forced second try on the local model when it did not act (it ignored the obligation anyway, and cost about 1.7 s) is gone: Mistral says nothing was done and asks what is missing.

## 0.15.0 — The local model acts, Mistral speaks

- The local model no longer plays Igor: it gets a short working identity ("the home-control module of a voice assistant"), plus the new option `local_llm_prompt` for your working rules (phone scripts, contacts, calls, timers). Less to read, so faster. Your persona goes to Mistral only.
- When Mistral words a reply for the local model, it gets `custom_prompt` and one line of spoken style, not `custom_prompt_voice`, whose rules are for acting: about 600 tokens a reply instead of 1 500.

- With the local model, a plain order ("allume la lumière du salon") is carried out by the local model, which says nothing; Mistral Large then words the reply as Igor. Mistral receives only what was done ("Fait : Lumière salon allumée."), with the persona: never your sentence, the state of the house, the contacts or the conversation. If it does not answer within 4 seconds, Igor says the plain sentence ("Lumière salon allumée.").
- Questions about the house and contacts are still answered by the local model, which keeps that information at home. Scripts (timer, calls, SMS) are still worded by the local model too.
- The prompt is read ahead once a minute instead of every 15 seconds (and still right after each request), so the graphics card's fans spin up less often.
- `ear/tools/llm/install.sh` no longer forces the graphics card to its highest clocks, which kept its fans loud; run it again to put the card back on automatic clocks.

## 0.14.0 — Each request where it belongs

With the local model (`local_llm_url`), a spoken or typed Assist request now takes one of three paths:

- **A plain order** ("allume la lumière du salon"): the local model acts, and Igor says what Home Assistant reports it changed itself, at once and without a second model call: "Lumière salon allumée.", "Volets salon fermés.", "Chauffage chambre réglé sur 19 degrés.", "Rappel programmé pour mercredi 29 octobre à 19:00." Scripts (timer, calls, SMS…) and anything whose result must be read are still worded by the model.
- **The house, the phone, contacts**: the local model answers. Nothing leaves the house.
- **Conversation and general knowledge** ("pourquoi le ciel est bleu ?"): the local model hands the question, rewritten to stand alone with no name, number or detail of the home, to the main model (Mistral Large), which answers as Igor from that question and the persona alone. It never sees the home, the memory, the contacts or the conversation. About 1 500 tokens a question instead of 16 000.

## 0.13.0 — The local model reads ahead

- **Prewarm**: Igor has the local model read the next spoken request's prompt ahead of time (persona, tools, house, history, live state, the time), without your words, right after each answer and every 15 seconds. When you speak, only your sentence is left to read. A new minute or a device that changed only costs the end of the prompt, read while nobody speaks.
- The time given to the local model is to the minute, so the prompt read ahead matches the request's word for word.
- `ear/tools/llm/install.sh`: one slot again (requests follow each other, and the prewarm keeps the slot ready), 4 GB of prompt cache in memory, and the graphics card kept at its highest clocks (`igor-gpu-high`). Run it again on the VM to apply.

## 0.12.2 — The local model vouvoie and stops repeating itself

- On the local model, Igor answered three different questions with the same sentence, word for word, and switched to "tu" after being addressed with "tu".
  - It now uses the sampling Qwen recommends for answers without thinking, including a penalty on repeating itself.
  - A short reminder goes right before your words: always "vous", never repeat an earlier answer word for word, and ask to repeat a sentence that makes no sense (failed speech recognition).

## 0.12.1 — A short prompt for the local model

- On the audio VM's Radeon VII, reading a prompt slows down as it grows: 576 tokens per second at the start, 170 after 8 000, 94 after 16 000. Igor's full voice prompt (16 600 tokens) took four minutes. The local model now gets a short one:
  - the voice rules in one short block instead of the long spoken instructions;
  - nine tools instead of fourteen: devices, contacts, reminders, "préviens-moi quand", the web. Automations, a sensor's history, the cameras and forgetting a memory stay in chat threads, and Igor says so if asked by voice;
  - the last 6 messages of the conversation instead of 20.
- With the persona split into `custom_prompt` (short, common), `custom_prompt_voice` and `custom_prompt_thread`, the local prompt is about 6 000 tokens instead of 16 600.
- `ear/tools/llm/install.sh` now runs the model with two slots and a prompt cache in memory, so the start of the conversation's prompt is read once and kept, while what Igor learns from each answer is worked out in the other slot. Run it again on the VM to apply.

## 0.12.0 — Assist on the house's own model

- **New options `local_llm_url` and `local_llm_key`**: Assist and the voice answer with a model that runs at home (Qwen3 8B on the audio VM's graphics card, installed by `ear/tools/llm/install.sh`). On the bench it called the right tool 20 times out of 20 and spoke its answer about 2.3 s after the request.
  - Everything around the answer stays at home too: the "was this said to Igor?" check, the order check and what Igor learns for its memory. The search of old messages by meaning and the fast model, which would send your words online, are not used for these requests.
  - If the local model does not answer, Igor says so ("Le modèle local ne répond pas pour le moment"). The request is never sent to the online model instead.
  - Chat threads stay on the main model, as do requests with an image (the local model does not see).
  - Leave `local_llm_url` empty to keep Assist on the main model, as before.

## 0.11.15 — Spoken answers stay short

- A spoken (or typed Assist) answer could turn into a numbered list of several paragraphs, on a "why" question for instance: the persona's "two short sentences" sits thousands of words before the question, and the model forgot it.
  - The rule is now repeated right before your words, where the model heeds it best: two short sentences, no list.
  - As a safety net, a spoken answer stops after three whole sentences. It always ends on a finished sentence, never in the middle of one, and list numbers and bullets are no longer read out.
  - "Détaille", "explique-moi en détail", "les étapes", "liste-moi", and anything about an SMS or a message to read back, lift both.
  - Chat threads are not concerned.

## 0.11.14 — The house watch: your sensors, plain alerts, told once

- **Choose what is watched**: two new options. `watch_entities` (only these are watched, when filled) and `watch_exclude` (never these), comma-separated, with `*` for "anything" (`binary_sensor.car_*`, `sensor.*_processor_*`).
- **Plain alerts** (with `lean_mode`, the default): an alert is sent exactly as the check found it ("Fuite cuisine : humidité ou eau détecté(e) depuis 3 min."), no longer reworded by the model, which once turned a rain sensor where the car is parked into "it is raining inside the car". One model call less per alert. Safety classes are now said in words (humidité ou eau, fumée, gaz…) instead of "moisture".
- **Told once while it lasts** (with `lean_mode`): an alert is not sent again every hour while the sensor stays on; it comes back only after the sensor went back to normal and is triggered again.

## 0.11.13 — Lean requests; chat threads without memory

- **Lean requests** (new option `lean_mode`, on by default). After an audit of every step a request goes through, the ones that cost time without paying for it are switched off. They are all still in the add-on: `lean_mode: false` brings each of them back.
  - The memory is read simply instead of through Shodh's "smart" search, which took about 420 ms a request.
  - The voice no longer searches its old messages by meaning (two Mistral calls a request): it reads its whole stored conversation, its last 20 messages, instead of 12. Nothing it could find before is lost. Threads keep that search, and no longer wait for it to store a message.
  - What is left is read all at once rather than one step after another.
  - The fast model and the second model that checked whether a sentence was an order are no longer used. A sentence starting with an order verb is still checked, without an extra call.
  - Spoken answers no longer wait to rule out the "not for me" code, which nothing produces since 0.11.8.
  - Six tools of no use in a spoken answer are no longer sent with each voice request: long-term statistics, the services list, listing, changing and deleting automations, sending a notification. They stay in threads and typed Assist.
  - The morning briefing reads its last 2 messages instead of 20.
  - A `[timing]` line in the add-on log gives, for each request, how long each step took and when the first word came.
- **Chat threads without memory**: the new value `thread_memory: off`, now the default, gives each thread its own conversation and nothing else. A thread neither reads nor writes the memory, so nothing said in a thread reaches the voice any more, and the voice keeps its own memory. Asked to remember something, a thread says it stays in its conversation and that lasting memories are given by voice. If your configuration says `thread_memory: shared`, change it to `off` (or remove the line).

## 0.11.12 — Igor finds your contacts itself

- **Calling or texting someone**: Igor was handed the whole contact list and asked to read it, and on "appelle Jean Martin" it searched the house's devices instead, then said the contact did not exist although it was on the list it had just shown. A new tool, find_contact, has the add-on search the list itself: it runs your contacts script, finds the person whatever the spelling, accents or order of first and last name, and gives Igor only the matching contacts with their numbers. It also tells whose an unknown number is. The script is found by itself (the first exposed script with "contact" in its id that returns a result) or set with the new option `contacts_script`.

## 0.11.11 — Igor remembers only what you ask it to

- **Memory on request**: Igor used to learn by itself from almost every exchange, chat threads included, so its memory filled with whatever had been discussed, and that came back in unrelated spoken answers. It now remembers only what you ask it to remember in words ("retiens que…", "souviens-toi que…", "mémorise…", "n'oublie pas que…", "garde en mémoire…", "note que…"), and only that. "Rappelle-moi de…" stays a reminder and no longer touches the memory. Forgetting works as before ("oublie que…", confirmed first). The new option `memory_learning: auto` brings the old behaviour back.
- **Wipe the memory**: the memory page of the panel has a "Tout effacer" button (asks first). It now really erases everything: clearing used to stop after the first 100 memories.

## 0.11.10 — Thread answers appear as they are written; the whole morning briefing; no stop after a colon

- **Spoken answer stopping after a colon**: an answer like "Résultat : *Octopus Eco* est le moins cher" stopped at "Résultat :". The model's italics right after a colon were taken for an aside about itself ("*Je corrige :*"), which ends the reply. Only an italic opening a sentence (after a full stop, a question mark…) still does; after a colon it is emphasis and is simply not read.
- **Morning briefing cut off**: a scheduled answer was sent as one phone notification cut at 900 characters, so a full briefing always ended mid-sentence ("Maison : Tout est en ordre, mais la lumi…"). It is now sent whole, in as many notifications as needed (up to four of 1,500 characters, "☀️ Résumé du matin (1/2)", "(2/2)"), each cut between paragraphs or sentences. The full text is still in the "Résumé du matin" thread.
- A thread answer could look stuck, for example on "Je vous recommande donc :" just before a table. The server held written text back until the next full stop, to check it for loops, and a table has none: nothing more appeared until the whole answer was over. Written answers (threads and typed Assist) are now passed on as they come, and only watched for a loop. Spoken answers are unchanged.

## 0.11.9 — Chat threads no longer stop mid-answer, and read like a page

- **Easier to read**: in the chat panel, Igor's answers are no longer in a bubble. They take the whole width, like a page, in larger type (16.5 px, 16 px on a phone) with more space between lines, larger headings and full-width tables. Your own messages stay in a small blue bubble on the right. On a wide screen the text stays centred at a comfortable reading width.
- A written reply was cut as soon as one of its sentences came back word for word: the guard against loops, made for the voice, also ran in chat threads, where a table with two identical cells ("Bon rapport qualité-prix.") or a list with a step said twice is normal. The reply stopped mid-table, and that cut version was what was saved. In threads and typed Assist, only a real loop is cut now: three sentences copied again in the same order, never table rows or code. Spoken replies keep the stricter guard.
- A thread reply may now use 16,384 tokens whether or not it reasons first (8,192 before), and when it still reaches that limit Igor goes on by itself, up to three times, into the same message. This happens on the server, so it finishes even if you leave the page.

## 0.11.8 — Talked about, Igor really stays silent

- 0.11.6 asked the main model to answer a code word (NOT_FOR_ME) when a sentence from the always-on microphone talked about Igor rather than to it. Mistral did not keep to it: it often said instead, sometimes in English, that the sentence was not for it. Now a separate, very short call to the memory model (`extraction_model`, ministral-8b here) decides first, and can only answer yes or no. When the sentence was not said to Igor, the main model is never called: no answer, no voice, nothing kept or learned. Only spoken sentences where the name comes after their opening are checked ("c'est Igor qui a éteint", "éteins le salon, Igor"); "Igor, allume le salon" goes straight through, with no added wait. If the check fails or hesitates, Igor answers as before. Cost: a few hundred tokens on the small model, about a third of a second.
- The NOT_FOR_ME instruction is gone from the main prompt. If you added a NOT_FOR_ME sentence to your own `custom_prompt_voice`, remove it. A spoken reply that still contains the code anywhere is cut to silence.

## 0.11.7 — Spoken answers no longer stop mid-sentence

- 0.11.6 ended a spoken reply at its first asterisk, to stop the loops that open with an aside ("*Je corrige :*"). But the model also writes bold in Markdown ("Le numéro de **Jean Martin** est…"), so answers stopped at "Le numéro de" or "Je ne trouve". Bold, code marks and italics inside a sentence are now simply dropped from spoken replies (the voice no longer reads them either), and only an aside that opens a sentence still ends the reply.

## 0.11.6 — Igor knows your scripts; loops cut sooner; talked about, not to

- **Scripts**: the fields of a script are not in its entity's state, so Igor could see `script.minuteur` without knowing it takes a `recipient`, and it often called `script.turn_on` with the fields at the top level, which Home Assistant refuses. Every request now lists the scripts Igor may run (the exposed ones), with Home Assistant's own description of each and of its fields, and whether it returns a result. A call to `script.turn_on` on one script, or one naming `script.<name>` as the service, now runs that script itself with its fields: its result (a contact list, a converted timestamp) comes back to Igor.
- **Loops**: a spoken reply is now also cut when it says the same thing again in other words ("Le minuteur est lancé." then "Le minuteur est bien lancé."), and where it opens an aside about itself between asterisks ("*Je corrige :*").
- **Not said to Igor, no answer**: Igor itself now judges, with the whole conversation in view, whether a sentence from the always-on microphone was said to it. When it was clearly about it or between other people ("c'est Igor qui a éteint"), it answers nothing at all: no "je n'ai pas compris", nothing on the tablet (back to rest at once), and the sentence is not kept in the conversation or learned from. It costs no extra request: the sentence was going to Igor anyway.
- **igor-ear**: a sentence that talks about Igor rather than to it is ignored ("c'est Igor l'autre jour qui a fait ça", "demande à Igor", "Igor a encore éteint"); said to Igor, the name stands first, last or between commas, and an order is always taken. The voice detector is kept fresh (cleared after each sentence and every 3 s of silence): fed the room's noise without a break it drifted until "Igor" was no longer heard, half a minute to a minute after a start. A lone "Igor" written by Whisper with a word or two around it ("Je m'appelle Igor") now opens the 8 s to say the order. On the hub: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## 0.11.5 — Chat threads that think only as much as needed

- Chat-panel threads now adapt reasoning to the request: greetings and simple home-state questions skip reasoning, everyday conversation uses low effort, and explicit analysis, debugging, comparison or substantial prompts keep the configured reasoning level. A reasoning level explicitly chosen for a request still takes precedence. The configured thread level is the ceiling, so complex requests retain the existing quality setting while routine turns can start and finish sooner.


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
