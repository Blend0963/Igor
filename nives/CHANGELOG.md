# Changelog

## 0.38.30 — The map that comes back, the places that come with it

- The Igor (CARTO) base map is back in the layers' panel, next to Route (TomTom Orbis) — Orbis has been failing about every other load lately, and a map that answers beats a map that knows the jams. It is the default again for a fresh screen; a screen that had chosen Route keeps it (one touch on « Igor » in the layers to come back).
- The places are back with it: stations-service, bornes de recharge, parkings, aires de repos, toilettes, hôpitaux — drawn by the card from OpenStreetMap (Overpass) again, each with its colour and its toggle in the layers' panel.

## 0.38.29 — The arrow that keeps up, the word that never had to be said

- The incident pop ("Trafic coupé · 2,4 km", the yellow box at the top right) is gone: the jams live in the side bar, a closed road asks for its detour by itself, and the incidents stay drawn on the map. The radar and danger-zone warnings keep their place.
- The arrow no longer falls behind between two fixes. It used to advance 4 s past the last GPS point and then wait for the next one — with a phone reporting every 15–30 s, that was up to 200 m of lag. The estimate now goes on at the last known speed until the next fix: the OBD's when it answers (up to 3 min, the tunnel case), else the GPS's own (20 s at most — the fix, whenever it comes, stays the truth). An OBD sensor silent for 45 s is no longer believed.

## 0.38.28 — The toast that knows when the speed is there

- Portrait: the toast keeps the whole row again — centred as before — when the speed square is not on the card (`show_speed: false` and not fullscreen, the car's dashboard in its place). It steps to the square's right with the same 6 px gap only while the square is actually shown (the phone GPS, or the card fullscreen).

## 0.38.27 — The phone that stopped answering

- A GPS card with a `fallback_entity` now watches its primary: entity gone, or the arbitration driving on the fallback, and a band stands in the card — « téléphone introuvable · GPS de la voiture en secours » (or just « téléphone introuvable » when the fallback is dead too) — until the phone answers again. Said once when it happens: a toast of 5 s, and a spoken line of the alert kind (heard with the voice on « tout » or « alertes », silent when the voice is cut). Portrait, the band sits above the speed square; landscape, above the toast row.

## 0.38.26 — The portrait bottom, each in its place

- Portrait: the street name takes the whole width at the bottom; above it the speed becomes a true 72 px square, its figure centred inside, sitting 6 px above the bar — the same gap the top buttons keep; the toast sits at the square's right with the same 6 px, on the same row, and wraps upward when it is long. Guided, the eta bar takes the very bottom and the whole row climbs above it (a `guiding` class follows the eta's visibility). The head unit's landscape layout is untouched.

## 0.38.25 — The line breathes with the zoom

- The drawn lines follow the zoom now: thin on the overview (2.5 px, they no longer smother the map), road-wide at the zooms one drives at (7 px at zoom 16, 10 px at 18). The dark halo follows proportionally, the alternates, the trail and the incidents stay a step thinner than the chosen route. Pure paint: the GPU interpolates the width, nothing to download, nothing new to compute.

## 0.38.24 — The yellow word finds its own row

- Portrait: the toast (the yellow-edged word — « Déviation · route fermée », ZFE, voice mode) had the same row as the street name — it covered the street, and on the previous release the speed box too. It now has its own row above the speed box, and the road-closure pop rises above it. From the bottom: eta bar, street name, speed box, toast, popups.

## 0.38.23 — A speed box with room to breathe

- The fullscreen speed box appears at once (it waited for the next position read: parked, that could be forever).
- Portrait: the speed box is wider (three digits fit with room to spare, and it still grows with the figure) and climbs above the street-name row — nothing touches the eta bar any more, and the road-closure pop rises above the box. Landscape: the eta bar steps 132 px aside, clear of a three-digit speed.

## 0.38.22 — The speed that follows the fullscreen

- A GPS card set with `show_speed: false` (the car's dashboard) now shows its speed box when it takes the whole screen, and hides it again when it goes back to its place; the eta bar steps aside while the box is there. The phone GPS (`show_speed: true`) is unchanged — always shown.

## 0.38.21 — The wall that fills a phone held upright

- `stack_below: 0` now means what it says: the wall never switches to its stacked (scrolling) phone layout and fills the screen instead — the GPS card grows to the whole height, the buttons stay at the bottom. Before, the zero was swallowed by the default (760) and a phone's GPS stayed a third of the screen.

## 0.38.20 — The map fills the screen, and stands upright

- A new button on the GPS card: the map over the whole screen (the dashboard's bar and neighbours beneath it, the card's own panels, toasts and popups riding along), and the same button back to its place.
- The card held taller than wide (a phone in portrait) tightens itself: compact guidance banner, smaller speed cluster and limit sign lifted above the arrival bar, narrower alert column — so nothing sits on the map. Landscape (the head unit) never sees it.

## 0.38.19 — The finger that moves the map no longer turns the page

- The GPS card's map and the bar's sliding tab strip join the swipe exclusions (`no-swipe`): dragging the map moves the map, sliding the tab strip reaches the hidden tabs — neither changes the dashboard's page any more. The swipe between tabs keeps working everywhere else.

## 0.38.18 — The house said http, the phone wanted https

- The phone's grey map is explained at last: behind a proxy that ends the TLS (nginx + a WAF), Home Assistant sees plain http and writes its own proxy links in http:// inside the Orbis style. A page arrived in https refuses those links (mixed content) — the style came, its tiles never did, and every browser on the phone failed alike while the head unit (plain http on the LAN) worked. The card now rewrites any house link said in http back to its own origin before handing the style to MapLibre, whatever host the house believed it was.

## 0.38.17 — The wound gets a name

- The style is fetched by the card itself before the map is drawn, and a failure there is now said in plain words on the screen: the server unreachable (with the address the browser really uses — a phone may not come the same road as the head unit), an answer refused (401 session expired, 403), or something else answering in the style's place (a portal, a filter, a proxy). MapLibre's own failures on later requests (tiles, glyphs) now name the resource asked.

## 0.38.16 — The map says what ails it

- A grey map no longer keeps quiet: what went wrong (WebGL missing on the device, a style refused, tiles unreachable) is shown in the card's message band, instead of buried in the browser's console.
- The Orbis base map, its proxy and the traffic tiles open to every logged-in user: the TomTom key never leaves the house (the proxy adds it server-side), so the administrators-only gate guarded nothing the proxy had not already closed.

## 0.38.15 — The line that follows the road's curve

- TomTom's route points stand some ten metres apart, so on a bend the drawn line cut the curve the road makes. Each marked corner of the drawn line (the route, its jams, the alternatives) is replaced by a small arc that stays inside the two segments — the line hugs the road again. Only the drawing changes: the data, the sections' indexes, the bubbles are the search's own.

## 0.38.14 — The radar in the house's colours

- The radars' pin leaves the white disc for the house's own drawing: a dark rounded tile, the camera in a thin off-white line, one red spark — the red stays the alert's alone. Still drawn on the spot, nothing to host.

## 0.38.13 — The zone that swallowed the address

- The real thief was found: a Home Assistant zone whose name was merely CONTAINED in the request won before any search — a zone « Orléans » drove « 19 rue de Pathé à Orléans » to the town's middle, and « Porte d'Orléans » with it, for destinations and stops alike. A zone now wins only when the request IS the zone, the small words apart (« à Orléans », « vers la maison »); an address said reaches the search.
- The car's service calls leave a trace in Home Assistant's log: the query heard and the place chosen, so a next hunt takes minutes, not weeks.

## 0.38.12 — Settings the house keeps, a panel that offers everything, a place asked in its own words

- The layers' panel (the 3D buildings, the radars, the traffic) is kept by the house now, in its .storage: a head unit's browser that clears its own memory at each start finds its settings again. The cross of the map's place panel stands at the right, always.
- The « éviter » chips are no longer remembered from one trip to the next: opening the routes' panel offers everything again — the fastest, without motorways, without tolls, without the ZFE. What the driver chose for the trip under way is kept by the recalculations, nothing more.
- « Porte d'Orléans à Paris » asked the search in its own words: the place and its town go as « Porte d'Orléans, Paris » (a comma the search reads; a « à » it may swallow). And when the search understood only the town, the places come first in the question and the town last — « oui » and « la première » can no longer mean the middle of Paris. A place asked in several words that nothing answers is asked back, never taken in silence.

## 0.38.11 — A cross to close, a trip that stays, a place said word for word

- The map's place panel wears a small cross at its top: a tap on the map by mistake no longer traps the screen.
- The routes' panel closed without choosing keeps the trip as it was — only a destination asked for and not yet on the road is dropped.
- The place said wins, whole words and apostrophes apart: « Porte d'Orléans à Paris » goes to the Porte d'Orléans, not to the middle of Paris (« rte » hid inside « porte » and the query was read as a street). A street said with its town goes straight there; when the search understood only the town, the driver chooses — and nothing starts until he has.

## 0.38.10 — The low-emission zones, said and avoided

- The routes now know the ZFE: TomTom marks the low-emission stretches along the way, the choice's panel wears a red « ZFE » badge next to the « € » when a route crosses one (the grey bubbles too), a word warns when the car is about to enter one, and picking such a route says the vignette is required.
- A fourth choice, « Sans ZFE », computes the way that goes round the zones; the « Éviter ZFE » chip keeps them off this trip and the next ones. TomTom does not read the vignette's level — the badge says a zone is crossed, the driver knows what his Crit'Air allows.

## 0.38.9 — The choice again, and stops from the search

- The small map button no longer zooms out (the fingers do that): it brings the choice back — the panel of the routes, the best ways computed anew from where the car is, with the same 12 s before the fastest starts.
- Every row of the search's panel — the favourites, the earlier searches, the results — carries a small amber flag: it puts the place on the way as a stop, when a trip is under way.

## 0.38.8 — Bubbles that live on their grey line

- The alternates' bubbles no longer slide to the screen's edge: they stand on their grey route, and when the zoom takes that route off the screen the bubble goes with it — it comes back when the route comes back. While following, the bubble still sits on the readable part of the grey way, never over the car.
- A tap anywhere on the map asks what to do with the place: « Nouvel itinéraire » to go there, « Ajouter une étape » to put it on the way (when a trip is under way). The place's name comes from the map's own tiles — a station, a shop, a street — else the point stands for itself.

## 0.38.7 — Lights that stay seen

- The lights' band widens from 25 to 40 m: a light's OpenStreetMap node often sits back from the big crossroads it serves, and it was dropped from the map for that. Lights stay drawn all along the band (no direction rule — their tag is often wrong); the cameras keep the strict 25 m band with their direction check. And the map now weighs the eighty nearest points instead of forty, so a dense city keeps its lights on the line.

## 0.38.6 — One base map

- The TomTom Orbis map (« Route ») is the only base map: the layers' panel no longer chooses between it and the theme's CARTO one, and a screen that had picked another falls back on Orbis. The places (stations, parkings, toilets, hospitals, charging stations, rest areas) are no longer fetched from OpenStreetMap — the Orbis map draws its own — so Overpass is asked for the lights and the cameras only, and the old places kept on the screen are dropped. The lights' toggle stays; the radars, the danger zones, the live traffic and the 3D buildings too. A screen set with « traffic: false » (no TomTom key at all) keeps the theme's CARTO map.

## 0.38.5 — The place said, not the town

- A place said with its town (« Porte d'Orléans à Paris ») is no longer swallowed by the town: when the search answers with the town first while the query names a place, the named place wins (its name is the one said). A town asked alone (« va à Paris ») still goes to the town at once, and a numbered address still keeps its street result.
- The alternates' bubbles sit only on the part of the grey route that is its own — from where it leaves the blue route to where it comes back. On the way the two routes share, no bubble: nothing grey to read there. An alternate that never leaves the route shows no bubble at all.

## 0.38.4 — Radars that stay on my road

- The map draws only the cameras and lights of the road driven: the route while navigating, else the road under the car — never the road beside anymore. Three levels decide: on the way (15 m) the point is drawn; a little off it (15 to 25 m) a camera is drawn only when its OpenStreetMap direction really watches the car's way (the opposite carriageway's radar stays hidden), a light is drawn anyway (its direction tag is often wrong); beyond, another road, never drawn. The warnings (the spoken and shown alerts) follow the same rule — a radar is announced only when its camera watches the way.

## 0.38.3 — Alternates that read like Waze

- The alternates' bubbles sit on their grey route, where the driver reads them: away from the car while following (where the other route leaves, never over the car), at the middle of its route when the whole trip is on the screen. And the other choice never disappears: after taking the road without tolls, the one with tolls (or with motorways) stays greyed and comes back by itself when the alternates are rebuilt. A paying route says so with a small amber « € » — in the bubbles and in the choice of routes.

## 0.38.2 — Two base maps, and buildings that stand up

- The layers' panel keeps two base maps only — Igor (CARTO) and « Route » (TomTom Orbis) — and gains a « Bâtiments en 3D » switch: on the Orbis map the buildings stand up, their heights coming with the tiles already fetched (no extra request, but heavier to draw; off by default). A base map chosen before the others existed falls back on Route.

## 0.38.1 — Places that stay on the map

- The GPS card's places (fuel stations, parkings, toilets, hospitals, charging stations, rest areas, traffic lights) and the cameras no longer come and go. Overpass (OpenStreetMap's free service, often busy) is asked with a 20 s timeout — a hanging request used to stop every place from loading until the screen was reloaded —, two squares at once instead of one, the squares the car drives towards first, and a failure waits longer and longer (15 s to 4 min) instead of hammering the service.
- The squares read are kept on the screen for 30 days (IndexedDB), like the roads already were: a usual trip shows its places at once, without network, and a restart of the head unit no longer starts from an empty map.
- Cameras and traffic lights are drawn along the way or the route with a wider corridor (a radar beside the road, a light of the cross street one turns into), and a radar is drawn whatever its OpenStreetMap direction says — the tag is often wrong or absent, and valid cameras were left out. The warnings keep their strict rules; only the icons are generous.
- When Overpass does not answer, the layers' panel says so instead of leaving empty map.
- A spoken address (« 19 rue de Pathé à Orléans ») keeps its street result and never falls on the town alone; a street asked without its town (« va rue de Pathé ») is confirmed first when it exists in several towns. The stop's cross in the trip panel is centred again, the alternates' bubbles stay where the driver reads them (by the car, kept on the screen) and are recalculated at once when the whole trip is opened, and the Orbis « Route » base map loads again (its style name had one wrong character).

## 0.38.0 — A navigator you can read and hear

- **Igor's own voice** in `custom:igor-gps-card`: guidance is spoken by Igor's text-to-speech (made by the server, played on the screen, each sentence kept), with the browser's voice as a fallback. The voice button has three settings — everything (each turn), warnings only (cameras, jams, detours), nothing — kept by Home Assistant for the user, so it survives a restart of the screen. The first touch anywhere opens the sound (a browser rule); `tts_entity:` chooses another voice.
- **Warnings that leave the map in view**: a camera, a danger zone or an incident is a small tile under the limit sign, its distance in large figures; for a camera above the limit the card's frame flashes red, and turns green under it. No more banner across the map.
- **The way left as a bar** on the right when traffic slows ahead: the car at the bottom, the arrival at the top, orange and red where it slows, « bouchon · 6 min »; in a jam, the jam alone and « fin dans 4 min · 1,8 km ».
- **A closed road** is avoided with a word for a few seconds (« Déviation · route fermée », with « Annuler »), no alarm.
- **A choice of routes** after picking a destination by hand (with a TomTom key): the fastest, without motorways, without tolls — time, distance, jams, tolls and ferries — and what to keep off (motorways, tolls, ferries), kept for the next trips. Not touched for 12 seconds, the first one starts.
- From TomTom's route, at no extra request: the **limit of every stretch** of the way (shown at once, before OpenStreetMap), the **lanes to take** before a turn, and a word before a **toll** or a **ferry**. `nives.route` takes `avoid_types` and returns limits, lanes, tolls, tunnels, ferries.
- **Igor knows it is in the car**: a request from one of « The car's screen » users reaches Igor with where the car is and where it goes, and goes to the online model. No keyword: any way of saying « on va au 15 rue du Saucisson », « finalement on va rue du Papillon », « sans autoroute », « recalcule », « on arrive quand ? », « c'est quand le prochain péage ? » is understood, and Igor confirms « OK, on va à … » with the distance and the arrival time. A place asked by voice opens the same choice of routes as by hand (the first one starts by itself). New `nives.car_status`; `nives.car_go` takes `avoid` and `reroute`; Igor's tools `car_navigate` (avoid) and `car_trip_status`.
- **A phone as a second position** (`fallback_entity:`): the card takes, at each moment, the position that is recent and the more precise — the phone's while the head unit looks for its satellites or loses them, the head unit's once it is fresh and good — and says which in a word when it changes.
- **Icons twice as large** on the map, cameras larger still, drawn sharp.
- **The finger moves the map**: every touch holds it and restarts the wait before it follows the car again (`follow_pause`, 15 s); a new button shows the whole route for 20 seconds.
- Incidents are asked from TomTom every 5 minutes while driving (2,500 requests a month on the free plan).

## 0.37.8 — A head unit that keeps up for hours

- A wall follows the house at most every 250 ms (`refresh:`, 0 for every change): a car's sensors change dozens of times a second, and every change redrew every card. A small screen (a car's head unit) fell behind after a while, showing the speed and the position late.
- `custom:igor-gps-card` draws the map 20 times a second while the car moves (`fps:`) instead of at every screen frame, 3 times when it stands still, and not at all when nothing moved; a screen that cannot keep up is drawn less often (down to 6) and more again when it can. The movement is eased by time, so it looks the same at any rate. No label fade, at most 2 device pixels per pixel (`pixel_ratio:`), `buildings: false` for a map without its buildings. The card reads Home Assistant only when its own entities changed; the places are redrawn only when they change and kept lighter (12 km around the car); the trail is updated once a second and loses its oldest points one at a time.
- The limit sign no longer waits for a free service at each road: OpenStreetMap's roads are read by squares — the big roads (motorways, trunks, primaries) 7 km around and far ahead, every road in 800 m squares around the car and ahead of it — each read once, kept for the drive and stored on the screen for 30 days, so a usual trip shows its limits at once and without network. Where the map has no limit for a road, TomTom's is asked (`nives.car_limit`, a key in Igor's options; once per road, at most every 10 s).
- Speed cameras from three sources, merged (a camera known twice within 60 m is one): OpenStreetMap's cameras, OpenStreetMap's « enforcement » relations (many cameras are only mapped that way: speed, average speed, red light), and in France the Ministry of the Interior's own list of about 3,700 automatic cameras (`nives.car_cameras`, read once a week and kept; `cameras_official: false` to leave it out). The warning says the kind: « Radar fixe », « Radar tronçon », « Radar feu rouge » (amber, no speed), « Radar passage à niveau ». TomTom's public API has no cameras; its accidents, roadworks and closed roads are warned about as before.
- The address search goes through Igor (`nives.car_search`): with a TomTom key, TomTom's search (addresses with their numbers, shops, biased to where the car is), with results as you type; without, OpenStreetMap asked within about 60 km of the car first, then anywhere, nearest first (a street of the town you are in no longer comes after one 300 km away; a town asked by its name still comes first). « Emmène-moi à … » uses the same search.
- `custom:igor-carmedia-card`: `active:` takes several entities (any of them on is on), a lost link of less than 3 minutes changes nothing, and a title is hidden only when it is older than the 20 minutes before the car started — a Bluetooth hiccup of the OBD adapter no longer blanks the music until the next track.
- The chat threads no longer lock with the house's key: the key locks Assist, the voice and the screens; the thread panel, behind its Home Assistant login, always answers. Igor's options get « Lock the chat threads with the key too » (off by default) for those who want them locked as before.

## 0.37.7 — The town's limit, not the motorway's

- `custom:igor-gps-card`, the limit sign: off the roads it has read (a street not loaded yet, OpenStreetMap busy), the card no longer keeps showing the last road's limit as if it were this one's — the motorway's 130 carried into a town. The last limit seen is now carried, greyed, only along the same kind of road; a street with no sign in the map shows what such a street is in France, greyed as probable (50 in a residential street, 20 in a living street); otherwise the sign is barred. `speed_limit_entity` (a sensor polled every 15 s, reading any road within 20 m) is used only when it is less than 45 s old and the card knows no road under the car.
- A closed road on the route (from TomTom, the only source of closures) is avoided at once, without asking: « Route fermée · déviation » for 10 seconds and « Route fermée sur votre itinéraire, je vous dévie » spoken (`closure_ask: true` brings the question back).
- « Route déviée · nouvel itinéraire » stays on top for 10 seconds, long enough to be read, before the next instruction takes its place.
- A road named after its number (« A 10 ») shows the shield alone.

## 0.37.6 — The traffic on your route

- `custom:igor-gps-card`, the traffic is the route's own: no more green over the whole map; the route stays blue where it flows, turns orange where it slows and red where it is jammed (TomTom's traffic sections of the route), the arrival time counts the jams (« arrivée 21:05 · dont 6 min de bouchons ») and the route is asked again every 3 minutes while driving, so colours and time follow the traffic. The whole map's traffic stays one touch away in the layers list (« Trafic sur toute la carte », `traffic_map: true`).
- The instruction on top says what to do and how far (« 1,2 km · Prenez la sortie 14 »); the road's name, its numbers and « direction Fleury-les-Aubrais » come only when the turn is near — about 25 seconds ahead: 250 m in town, up to 1.5 km on a motorway.

## 0.37.5 — TomTom finds the places

- The car's services for the head unit's account without making it an administrator: Igor's options get « The car's screen (not administrators) »; the users chosen there may use the live traffic (incidents and the flow tiles), TomTom's routes and the guidance services (`nives.traffic`, `nives.route`, `nives.car_go`, `car_nearby`, `car_stop`); everything else stays for administrators. A screen whose account is refused says so in the layers list instead of « add a TomTom key ».
- With the TomTom key, « où est la station-service la plus proche ? » asks TomTom: along the route, its places (brands, a richer map of France) with the detour TomTom works out itself, up to 15 minutes; not guided, its places around the car. Without a key, or when TomTom does not answer or finds nothing, OpenStreetMap as before. The GPS card's dots, cameras, lights and limits stay on OpenStreetMap (free and unlimited; TomTom's free quota would not last a drive).
- `custom:igor-gps-card`: the third Overpass mirror (maps.mail.ru), whose certificate browsers refuse (« could not be loaded securely »), is replaced by overpass.kumi.systems.

## 0.37.4 — Igor drives the GPS

- **Igor guides the car.** Tell it « emmène-moi à la maison », « mets-moi un trajet pour la gare d'Orléans », « arrête le guidage »: the car's GPS card guides there (home and Home Assistant zones first, then the place nearest the car), and Igor says the distance and the arrival time. Ask « où est la station-service la plus proche ? » (or charging, a rest area, toilets, a hospital, a pharmacy, an ATM, a supermarket, a restaurant…): while guided, Igor looks along the route ahead and says, for the best place, how far along the way it is, whether it is on the route or a detour of a few minutes, and whether it is on the motorway (« aire de … »); then it asks whether to stop there. « Oui » adds it as a stop: the card guides there first (an amber flag), says « vous êtes arrivé à l'étape », then goes on to the destination. Set the car once in Igor's options (its position and the GPS card's destination input_text). New services `nives.car_go`, `nives.car_nearby`, `nives.car_stop` (administrators only), the tools `car_navigate`, `car_find_nearby`, `car_add_stop` for Igor (the local model too); `nives.route` takes stops.
- `custom:igor-history-card`: each line on its own scale (a speed and an engine speed, a turbo and a rail pressure no longer share one), each line's low and high written under the title in its colour, a line from zero only when it goes near zero (a battery's 12 to 14.4 V now fills the chart), thicker lines; a chart of three hours or less is drawn again every 30 seconds. `scale: shared` keeps one scale.
- `custom:igor-gps-card` believes a precise GPS: how far the arrow may be put on a road (or held on the route) now follows the accuracy the GPS gives — twice it plus 5 m, at least 10 to 12 m — instead of a fixed 45 to 50 m. At 5 m of accuracy, a service area 30 m beside the motorway is shown as the service area; at 150 m the car stays on the motorway. A new route comes after 5 s farther than that from it (25 m at least).
- In a tunnel (no fix for more than 4 s) while the car's own speed (`speed_entity`, the OBD) says it drives, the arrow goes on at that speed along the route when guided, else along the road it is on, for 3 minutes at most, with « gps perdu · position estimée » under the limit sign; a vague network position that agrees with the estimate does not pull it back (`dead_reckoning: false` to turn it off).
- `custom:igor-gps-card`: road shields as in France — a small cartouche (red for A and N, yellow for D, green for E), no longer stretched across the arrival bar; « sur la route » moved under the limit sign.
- `custom:igor-gps-card`, places: read square by square (about 3 km) over all the map shows around the car (6 km at most), the nearest first, one square a second, each kept for the drive: fuel stations, rest areas, hospitals, toilets, parkings fill the whole view, beside the road or not. Nothing is cut off any more (a city's hundreds of traffic lights could push the fuel stations out of the answer). Cameras and traffic lights show only on the car's way (ahead on its road, or on its route).
- Overpass, the free service behind it, is often busy: the card now moves on to a mirror when it does not answer.
- The limit sign follows the road at once: the roads ahead are read before the car gets there (a few hundred metres, more the faster), the road under the car is checked twice a second, and the card's own reading now comes before `speed_limit_entity` (a sensor polled every 15 s lagged behind at each change; it only fills in where the road says nothing).
- `custom:igor-carmedia-card`: new `active:` (the car's OBD link, such as `binary_sensor.voiture_en_ligne`): car off, « Pas de musique »; car on, only a title that changed since it started — the head unit's sensors kept the last track of the previous drive.

## 0.37.3 — What is on the road

- `custom:igor-gps-card` shows what is around the car, from OpenStreetMap (nothing to sign up for): traffic lights, fuel stations, rest areas by default; charging points, car parks, toilets and hospitals from the new layers button (kept by each screen; `pois:` sets the first choice). Asked again once the car has gone half the way to the edge, at most every 20 seconds.
- Speed cameras, worldwide, as a setting (`cameras:` or the layers button): **danger zones** (the default — 300 m in town, 2 km on roads, 4 km on motorways, without showing where the camera is, as French law requires), **cameras** (each one on the map and announced at 500 m, 1 km on fast roads, with its limit), or off. Only cameras ahead of the car (or on its route) and watching its way; the warning turns green below the limit and is spoken once.
- The limit sign never leaves: unknown here, a grey sign barred; where the map says nothing for a while, the last limit seen, greyed, for 2 km.
- The road where the car is, with its number in the French colours (A and N red, D yellow, E green), at the bottom; in the arrival bar when guided (`street_names: false` to hide it).
- Guidance reads the signs: « Prenez la sortie 12 », or « Prenez la sortie Porte Dauphine » when the exit has no number, with the roads' numbers and « direction Rouen, Caen » under the instruction, spoken too.
- The zoom goes by stages, as a navigator: closer in town, wider on roads, wider still on motorways; it closes in 20 seconds before a turn (250 m to 1 km) and a little before traffic lights.
- Live traffic, ready for a TomTom key: in Igor's options, a new « TomTom key » field (kept in Home Assistant only, never in a dashboard). With it, the card shows the traffic flow over the roads, closed roads (dashed red), roadworks, accidents and jams, and warns about a closed road 3 km ahead and other incidents 1.5 km ahead. New service `nives.traffic` (administrators only, answers `enabled: false` without a key) and a logged-in tile relay; answers are kept a minute to spare the free quota.
- With the key, guidance takes TomTom's route (`nives.route`), which knows the jams and goes round the closures it knows (OSRM stays the route without a key, or when TomTom does not answer). A closed road still on the route ahead brings up a question — « Route fermée sur votre itinéraire » with **Éviter** / **Ignorer**, said aloud too: Éviter asks for a new route around it.
- The house lock: `allowed_users` now recognises a user by their login, their display name, their id or their person (name or `person.…`), not only the display name; Igor's options get a « Still answered while the key is away » list to pick users from (no name to type); and a refusal says who was refused (« « Autoradio » n'est pas dans les utilisateurs autorisés », or that the request came without a user).

## 0.37.2 — A navigator that knows which way it faces

- `custom:igor-gps-card`: where the car faces is worked out as a navigator does, from the car's own speed (`speed_entity`): stopped, nothing changes; under 9 km/h the car may be manoeuvring or reversing, the arrow keeps facing the same way and may move back; driving, it follows the real movement — a line fitted through the last fixes (least squares, 4 to 15 s), weighed with the GPS's course when fast — and turns round only when the car has really moved the other way (two concordant clues above 15 km/h, three below). A single reversed course, GPS noise in traffic or a wrong start no longer turn the arrow round, and a wrong arrow is no longer stuck (the « never backwards » guard now applies only above 15 km/h). A course of exactly north is no longer ignored.
- `custom:igor-carmedia-card`: the title no longer sticks on an old track. The head unit's session sensor is updated for a play, a pause or the position while keeping an old title, so it always looked « newest »: now the source whose *title* changed last wins (the notification's from its last change, the session's from when it is seen changing).

## 0.37.1 — Intelligent Governance & Operations Relay

- The opening says what IGOR stands for: once the eye is open and the name in, « INTELLIGENT GOVERNANCE & OPERATIONS RELAY » is typed under it, initials in red, with a red cursor; the opening lasts 3.6 seconds (a touch still skips it).

## 0.37.0 — Igor opens its eye

- An opening, after Home Assistant's own logo: the first time an Igor wall shows after the app starts, Igor's eye opens over it — the pillar rises, the red ring draws itself, the pupil lights and beats twice, « IGOR » closes in below — and fades into the dashboard after 3 seconds. Once per session (a page reload does not replay it); a touch skips it; `intro: false` on a wall turns it off. Home Assistant's own start-up logo, in its app and while its interface loads, cannot be replaced.
- The bar's line with `speed: auto` no longer freezes on a page that was left during its pause (Home Assistant keeps a page aside, and its next turn was dropped for good): turns go on as soon as the page is back, on every page.
- `custom:igor-gps-card`: the bottom bar keeps each figure on one line with its unit (« 450 m », « 1 min »), then the arrival time and the place on two lines at most; it no longer breaks apart with large text.
- `custom:igor-car-card`: today's high and low line up.
- New `custom:igor-trips-card`: a car's log readable at a glance — the running or last trip in large figures (km, minutes, L/100, €, eco), the last trips in clean rows (empty ones left out, coloured consumption and eco), the records at the bottom.

## 0.36.9 — Read from the driver's seat

- `igor-wall` takes `text: big` (×1.3), `huge` (×1.45) or a factor: every letter of every Igor card on the wall grows, the GPS card's too, and thin figures get a little bolder; made for a car's head unit read from the driver's seat.
- `custom:igor-car-card` takes `weather:` (and `outside:`, a temperature sensor): outside, as in a car — the weather where the car is, its temperature, today's high and low, and the next four hours with the chance of rain, in the space under the engine and battery figures.

## 0.36.8 — The wall's button hears the room

- The wall's « parler » button (the Igor panel of the bar, `igor-assist-card`) goes through the ear in the room when igor-ear runs (0.4.1 or later): it says « Je vous écoute » and takes the next sentence with the microphone that already hears the room, instead of the satellite's own, which could hear nothing. New service `nives.listen` (any user) fires `igor_ear_listen`; igor-ear says it is there with `sensor.igor_ear`. Without it, the satellite listens as before.

## 0.36.7 — Silence is silence

- Igor no longer acts on what speech-to-text makes up from silence (« Sous-titrage ST' 501 », « Sous-titres réalisés par la communauté d'Amara.org », « Merci d'avoir regardé », « [Musique] », a lone « Merci »…): nothing is answered, said or done. Igor's speech-to-text drops them and never sends a recording without a voice; the conversation agent drops them whatever engine wrote them.

## 0.36.6 — One ambiance at a time

- Scenes: one is « appliquée » at a time, the one set last; it goes when another is set, when « Tout éteindre » is touched, when a mode (`input_boolean.mode_…`, Cinéma) is turned on, or when every light of the card is off. A scene that turns things off (« Tout éteindre »: its name, or the `mdi:power` icon, or `reset: true`) is never shown as applied. `ambiance: true` / `reset: true` on a tile when the guess is wrong.
- Media players always say whether they are on: « éteint », « en veille », or what they play or run. A Cast entity that says « off » while its device is on (a Shield, a speaker) is lit by its device's other entities (an Android TV remote, its other player) or by `power:` on the tile.
- A fan says « arrêté » or its speed, its icon crossed out when off and turning when on; a projector, a speaker, a TV the same (their « off » icons).
- A robot vacuum's tile follows every state of the Dreame and other integrations (sweeping, mopping, washing, charging…): it turns while it cleans, says what it does and its battery, and turns red when stuck; « Base » moves while it goes home.

## 0.36.5 — Room to read

- Lists scroll instead of cutting their last lines (journal, containers, news), with a thin bar in the wall's colours.
- A binary sensor no longer lights a tile in amber as if it were a switch (« Ligne J » on the wall): a sensor stays neutral, and turns red only when it reports a problem (problem, safety, smoke, gas, moisture, battery…).
- On a wide screen, the bar's tabs take at most half its width and scroll if needed, so the running ticker keeps its room with the big bar.
- Every tile is alive, whatever its entity: lit in its kind's colour with a small breathing light in its corner and a word on what it does — a media player as soon as it is on (its source or app, the title it plays, paused), a fan turning at its speed (« oscille »), a shutter's icon going up or down while it moves (its « Ouvrir », « Fermer », « Stop » and a vacuum's « Base » tiles too), a thermostat heating or cooling in its colour, a lock open, a door or a presence sensor, a scene just set (a few seconds), a script running, an alarm panel armed; a thing unavailable fades, dashed, « indisponible ». The same on every `igor-tiles-card`, on every dashboard (the Commandes pages of the phone, the PC and the wall are the tablet's tiles); the corner light on big tiles too.
- An alarm clock tile (`alarm:`) opens the alarm clock in front on a tap — its time, its days, on or off — instead of switching it; while it rings the window also has « Répéter » and « Arrêter ». `igor-alarm-card` opens the same window.
- `custom:igor-bank-card` budgets: every spending category is listed (`categories:` with its spent sensor and its budget `number`), budgets first, then « pas de budget · toucher pour en fixer un »; a tap opens the budget to set it. Totals and what is left per day stay at the top.

## 0.36.4 — The tablet keeps up

- Tiles no longer stay on an old state when a kiosk tablet stops handing the cards Home Assistant's updates (a light switched off stayed lit until the page was reloaded): every tile is redrawn on each update, and the tiles read Home Assistant's live state themselves every 2 seconds.
- The big status bar comes by itself on a tablet: a screen set up with `?igor_tablet`, or the « Igor (tablette) » / « Igor Journal (tablette) » themes (`igor-bar-size: big`). `size: normal` in the bar keeps it small.

## 0.36.3 — A tablet read from across the room

- The wall's bar takes `size: big`: taller, larger letters, bigger eye, clock and buttons, for a small tablet seen from afar.
- Light tiles: off is plainly off (a faint icon, no colour); on, the tile takes the bulb's colour, from its colour or, for a white bulb, its warmth (kelvin), with a soft glow.
- Tiles come alive: a media player is lit as soon as it is on (a projector on its menu, a console on its home screen), in violet, its icon beating while it plays, with what it plays or its source; a fan in cyan, its icon turning at its speed; a mode or switch in amber, gently glowing, « activé »; a light shows its brightness. Off, nothing moves.
- One shape everywhere, sharp: every card, tile, button, panel, label and window of Igor's cards follows one radius, `--igor-radius`, taken from the theme's card radius; the Igor themes set it to 3 px (the Igor Journal theme went from 6 px, dialogs from 8 px). Only dots stay round.

## 0.36.2 — A navigator that keeps to its route

- `custom:igor-gps-card`, guided: the arrow stays on the route as long as it is within what the GPS may be off (45 to 120 m), never on a parallel street, and glides along the route itself; a new route only after 5 seconds really off it. Not guided, a parallel road going the same way takes over only after being clearly nearer for 3 seconds (a turn still switches at once). The zoom follows the speed (farther out on fast roads) and comes closer before a turn (`auto_zoom: false` to keep it still). The bottom bar (distance, time, arrival) takes the whole width.
- `custom:igor-buttons-card`: `form:` asks a few numbers before the action, each prefilled with its last value and saved in its `input_number` (a fuel fill-up: litres and price per litre, with the total).
- `custom:igor-carmedia-card`: the title follows the track: the newest of the session sensor and the title read in the player's notification wins (the session sensor of a head unit can keep an old title).

## 0.36.1 — Notifications as Home Assistant writes them

- `custom:igor-notifications-card` shows Markdown: titles, bold, links (a link to a Home Assistant page opens it), lists and pictures, including a picture written into the text as image data (a robot vacuum's maintenance notice). Built as page elements, never as HTML; a picture only from a web address or as image data. A touch on a notification opens it whole.
- A page left and opened again showed nothing until something changed in the house (the phone's « Commandes » one time out of two): the tiles, news, DNS, map, Wi-Fi, network and talkers cards are drawn again as soon as they are back.
- A button can open another dashboard by its sidebar name: `dashboard: Ma banque` (`igor-buttons-card`, the bank card's `links`), its address looked up, so it no longer lands on the home page when the address is not the one guessed. A bar's `tap:` without a leading « / » is a page of the same dashboard.

## 0.36.0 — Home Assistant's notifications on the dashboards

- `custom:igor-notifications-card`: Home Assistant's notifications waiting (✕ clears one), and the ones it sent (the phone app, `notify.rappels`, Telegram) with their time, channel, links and position, so a notification lost on the way can still be read.
- The integration notes every `notify.*` and Telegram message as it goes out, the newest 200 kept on Home Assistant's disk; `nives.notifications` reads them, administrators only.
- `custom:igor-bank-card`: a bank integration's accounts, month, spending by category with budgets, budgets left, operations by day and one in detail, in Igor's style with nothing else to install. Bar items take `below: 0` to turn red under zero.
- `nives.trip_map`: a tracker's trip drawn on a dark map, written to the media folder for a Telegram photo after a drive (administrators).
- The network map shows the WireGuard peers in a « VPN » block: connected or not, the public address each one connects from, its country and operator, last contact and traffic (privilege `VPN: WireGuard: Status`). The docs now give hass-opnsense `VPN: WireGuard: Configuration`: with « Status » alone its WireGuard sensors stay unavailable.
- `custom:igor-gps-card` guides: an address or a favourite (the flag), or a destination written in an `input_text` from a phone; the route on the map, the next turn and its distance, kilometres, minutes and arrival time left, the turns spoken in French, a new route when the car leaves it, the arrival. A button mutes the voice. Every new button is an Igor button with its icon (the destination panel, the notifications' clear, the keypads' erase), no symbols. The limit sign reads OpenStreetMap itself (the road the car is on, its direction) when the limit sensor has nothing.
- A bar with `tabs: true` keeps its tabs at any width: they scroll sideways when they don't fit (an unfolded phone), the open one in sight, and the clock is never cut.
- The wall's bar shows a bell with the count of notifications waiting, and a red dot when something was sent since the screen last showed the list (administrators); `notifications: notifs` opens that page, `notifications: false` removes it.

## 0.35.2 — A pencil to edit the dashboard

- The wall's bar has a pencil, for administrators only, that puts the dashboard in edit mode: Home Assistant's top bar comes back, with « Terminé » and the raw configuration editor, even on a `kiosk` wall that hides it. `edit: false` in the bar removes it.
- `custom:igor-buttons-card`: a button with `edit: true` does the same, hidden for other accounts.

## 0.35.1 — The alarm on a security page, with its code

- `igor-security-card`: the alarm's state in large (ARMÉE, DÉSARMÉE, INTRUSION), « armer » in one tap, « désarmer » only with the disarm code on a keypad (through `nives.disarm`, five wrong codes and ten minutes), the camera active or private in one tap, and the camera's saved positions (its device's `select` with « preset » in its name, or `presets:`).
- `nives.unlock_screen` refuses the alarm's entities outright: the maintenance code only ever opens a screen, never the alarm.

## 0.35.0 — A maintenance lock for the car, Igor's bar on the phone

- Maintenance lock: a wall with `maintenance: input_boolean.x` makes its device remember that switch; while it is on, every page of Home Assistant on that device lies under a full-screen « MAINTENANCE » lock with a keypad (the car's head unit lent to a garage). It opens with the disarm code (`nives.unlock_screen`, same lockout as the alarm: five wrong codes, ten minutes; each wrong code fires `igor_security` and a notification) or with the switch turned off from another device. The last state is kept on the device, so the lock is up at once after a reload, even before Home Assistant answers. The keyboard reaches the keypad only.

- A wall's bar with `tabs: true` on a phone: the pages' tabs take the bar and scroll sideways (the open one brought into sight), the machines' line and the date give them the room, the clock shows the time alone; the bar stays on top while a stacked wall scrolls. With `kiosk: true`, the phone shows Igor's bar instead of Home Assistant's, as the wall, the PC and the car do.

## 0.34.1 — On the road, like a navigator

- `igor-gps-card`: the arrow is always on a road, moving or stopped (no more car park exception that left it in a building), within 50 m by default, or what the GPS says it may be off by (`gps_accuracy`, up to 150 m). Only roads a car drives on count: no railway, path, footway or cycleway. A road going the car's way, and the road already taken, win over a slightly nearer one, so a noisy fix no longer jumps to a side street.
- A car does not turn back on its road: while it drives, a fix behind the arrow holds it where it is instead of pulling it back, a heading reversed by one doubtful fix is ignored (three in a row, a real U-turn, are believed), the arrow never takes a way that starts by turning back, and the trail does not come back on itself. Stopped, the heading stays as it was.
- When a fix comes late and far, the arrow drives there along the roads instead of gliding across, and the trail follows the roads: between two points it takes the shortest way on the road network drawn on the map (joined across tile cuts and crossings); what cannot be followed on a road starts a new piece of trail rather than a line through the houses.

## 0.34.0 — The car's map on the road

- `igor-gps-card`: obd2mqtt's `voiture-gps-card` brought into Igor (it now comes with the add-on, no file to copy) in Igor's look: cyan arrow and trail, dark speed box. The arrow sits on the nearest road drawn on the map, within `snap` metres (20; 8 when stopped, so a car park stays a car park), and turns with it; between two fixes it goes on along the road for 4 seconds at most instead of 8 straight ahead, so a late or imprecise GPS no longer drives through houses. The trail follows the arrow as shown.

## 0.33.4 — The vacuum's button, the car without Home Assistant's bar

- A robot vacuum's tile no longer calls `vacuum.start_pause`, which Home Assistant removed (« Action vacuum.start_pause introuvable »): it starts the robot, or pauses it while it cleans. Tiles and buttons configured with `vacuum.start_pause` do the same. The tile's icon moves with the robot: turning while it cleans, rocking on its way home, breathing in pause, red when stuck.
- `igor-wall`: `kiosk: true` hides Home Assistant's top bar (its tabs, search and assistant buttons) on that wall's pages whatever the device's theme: the car's head unit no longer shows two rows of tabs.

## 0.33.3 — The alarm on the tablet, Igor's journal in Igor's look

- `igor-tiles-card`: a tile `{alarm: <device_id>}` is an alarm clock (Alarm Clocks integration), as the wall's alarm card finds it: its time always shown under the name, lit while on, « coupé » when off; a tap turns it on or off, and while it rings stops it (the tile blinks amber); a long press opens its time.
- Igor's journal (the full-screen history, from « Historique ») takes Igor's look: near-black, bone white, cyan answers, amber for what went online, red for failures, Igor's eye and name in its bar, days marked with the red square.

## 0.33.2 — The key locks the thread panel too

- While the key is away, Igor's thread panel refuses as Assist does (« Igor est verrouillé : la clé est absente. »): the integration sends the key entity and `allowed_users` to the server (`POST /api/security`, at start and every five minutes), which reads the key before each panel request (a key that cannot be read locks too). People in `allowed_users` are still answered, by their Home Assistant user name or id, from their phone at home or outside. The installed app (API key, no Home Assistant login) is not checked. Give the wall, the tablet and the desk screen an account of their own (DOCS.md, « The house key »).
- The panel shows the server's reason when a request is refused, instead of « HTTP 4xx ».

## 0.33.1 — A bar that scrolls only when it must

- The wall's bar takes `speed: auto`: still while everything fits on the line; longer, it goes round once (about 40 px a second), stops back at its start, waits `pause` seconds (10 by default), then again. Still for those who ask the system for less motion.

## 0.33.0 — Igor in the car

- `igor-car-card`: a car while it drives: the speed in large, the engine speed as a segmented bar that turns amber then red, the coolant and the battery in colour, the trip's distance, consumption and eco score; greyed with « hors ligne » when the car is away.
- `igor-carmedia-card`: the music of an Android head unit (the companion app's media session), title and artist, three large buttons that send `command_media`.
- `igor-buttons-card`: `tap_action` (any Home Assistant action: open an app with `url: app://…`, the voice assistant, a confirmed `perform-action`), `eye: true` (Igor's eye as the icon), `color`, `secondary`, `fill`; a lone big button lies flat as a band.
- `igor-wall`: `above:` and `below:` cards across the whole width; in the bar, `name:` after IGOR and `tabs: true` to keep the tabs on a narrow screen.
- `igor-facts-card`: `remaining: km` (« dans 800 km », « dépassé de 200 km »), `below_warn` and `below_bad`, `zero:` for a value not set yet, `more:` for the entity a tap opens, `size: big`.

## 0.32.3 — Buttons for a finger, the eye on the phone

- The « Igor » theme puts Igor's eye at the left of Home Assistant's top bar (`igor-header-logo`), as on the wall: on a phone or a PC, before the tabs. Not on the tablet theme (no top bar there) nor while editing.
- `igor-buttons-card` takes `size: big`: buttons the size of the giant tiles (a large icon, the name under it), three a row unless `columns` says, so a phone's settings and links are easy to touch.

## 0.32.2 — The network map on a phone, the Wi-Fi rows apart

- Network map on a phone: one toolbar row that scrolls, the map on most of the screen with the detail under it (the card scrolls, a tap brings the detail into sight), two fingers zoom. The internet starts hidden there (the world map shows it); shown, the map is laid out wider and fitted, so blocks keep room for their names. A network's gateway only shows beside its name where it fits.
- Wi-Fi neighbours: wider columns, so « canal 149 » no longer runs under the signal bars; on a phone the name on its own line, the rest under it. Wi-Fi clients: the rates column no longer spills onto the signal; hidden on a phone.
- DOCS.md: the exact OPNsense privilege names for Igor's key, which of them also allow changes, and what the OPNsense integration (CPU, gateways, WireGuard…) needs with « Granular Sync Options » instead of admin.

## 0.32.1 — Threads in Igor's look

- The threads panel (Igor's own page) takes the wall's look: dark, the eye in place of the bow tie, red marks on titles and the open thread. What you say sits in a bubble on the right; Igor's answer is structured text across the whole reading column, without a bubble.

## 0.32.0 — What the firewall lets through, and what it refuses

- The network map reads OPNsense's firewall log: what it refused shows as red dashes (the same way through OPNsense), a « refusé ×N » under each block concerned, and a « refusé par le pare-feu » list (who → whom, service, rule, how many times) in OPNsense's, a network's and a device's detail. A device only ever refused still gets its place. « refusé » in the toolbar shows or hides them. The key needs the « Firewall Log » privilege (DOCS.md); without it, the map says so under « à vérifier ».
- « matrice »: the networks against each other (and OPNsense, the internet): what passes (volume, services) in green, what was refused in red; a tap gives the pair's flows, refusals and the rules concerned.
- The firewall rules, when OPNsense's rules API answers (`firewall/filter/search_rule`, recent versions; « Firewall: Rules » privilege): a network's detail lists the rules that name it (pass in green, block in red, disabled ones faded).
- The world map zooms: the wheel, a drag to move, « − » « + », « Europe » and « monde »; the arcs keep their width at any zoom.
- The floating « ‹ mur » button is gone by default (it covered the screen); a theme that wants it sets `igor-back-button: "1"`.

## 0.31.4 — Igor speaks over the switches

- The tablet's live voice display is now a sheet over the lower half of the screen, the switches dimmed behind; a touch outside closes it, a touch on it keeps it up. Igor's eye says where it is: cyan and pulsing while it listens, amber while it works, bone white while it answers, red when done, grey for « nothing heard ». It shows your words, Igor's steps (local or online, with their times), its answer and what was done; the switch Igor acted on flashes cyan behind.
- One reference: Igor's turn (its number); the satellite only opens the sheet at once and says when Igor has finished speaking. Every step has a limit, so nothing stays on screen: 12 s listening with nothing heard (« Je n'ai rien entendu », 3 s), 20 s for the words, 45 s of thinking (« Igor met du temps… ») then 90 s, and 6 s after the answer was spoken (a thin bar empties). A finished turn never comes back when new words start, and a turn without a satellite (« None ») is followed like any other. The full-screen history is unchanged.
- The network map's « Arbre »: each network's name above its hub and its gateway under it, and every flow goes between the rows, along a bus, never across a name; in « Par VLAN » too, a flow leaves a device through the gap above its row.

## 0.31.3 — Dark fields

- The « Igor » and « Igor (tablette) » themes are now declared dark (`modes: dark`): Home Assistant took its light defaults for what the theme did not set, so forms (an add-on's options, settings) showed white fields. Their text fields, selects, checkboxes and radios now take the theme's colours. Reload the themes (or restart Home Assistant) after updating.

## 0.31.2 — The network map shows, the wall tidied

- The network map stayed blank inside a wall: the card used a property named `hidden` for the networks switched off, which is also every HTML element's own `hidden`, so the whole card was hidden. Renamed.
- The world map: a chosen country's arc no longer fills into a yellow crescent; it is outlined in amber.
- Igor's card (`igor-assist-card`) shows Igor's eye instead of the blue lens: red at rest, cyan and pulsing while it listens, amber while it thinks, grey when switched off.
- Giant tiles take `states: true` to show the state under the name (a wall's « commandes » page of aligned switches).
- `igor-talkers-card` `by: vlan`: the traffic per network (out, in, devices) instead of per device.
- `igor-dns-card` `blocked: true` starts on the blocked queries (« what AdGuard blocks »).

## 0.31.1 — A tablet of switches

- `igor-tiles-card` `size: giant`: wall switches for a tablet made of buttons. A big icon in the middle, the name small under it, no state text; the tiles fill the card's height (`columns:` sets how many across). `labels: false` leaves the names out.
- A tile can call a service on its entity instead of switching it: `service: cover.open_cover` (with `data`), lit while the entity is in the state given by `lit:` (`lit: open`). One cover or vacuum becomes several buttons (open, stop, close; clean, dock).

## 0.31.0 — The network, to look after it

- `igor-netmap-card` redone for maintenance. OPNsense on top; each network (VLAN) is a block with its gateway and device count, linked to OPNsense by a bus; the internet's operators on a trunk at the right. Flows go from a device along its block's edge, up the bus, through OPNsense and down to the other side, their width by traffic, with moving dots.
  - Toolbar: layouts **Par VLAN**, **Arbre** (OPNsense, its networks, their devices, read left to right) and **Libre**; zoom − / + / ajuster (and the wheel); one chip per network to show or hide it; internet and traffic on or off; a search that highlights and centres a device (Enter); « réinitialiser ».
  - A device, or a whole block by its header, moves with the finger or the mouse; the layout then becomes « Libre » and is remembered on that screen (`key:` to share it between pages). A drag on the background pans.
  - Side panel: OPNsense (the default) gives each network's traffic to the others, the traffic between networks with their services, and what to check (DHCP leases not readable, devices without a name); a network gives its gateway, devices by traffic and flows out; a device its addresses, network, Wi-Fi and connections; the internet its operators.
  - `nives.net_map` now lists the networks and the router's address on each (`vlans`), WAN left out.
- New `igor-talkers-card`: the busiest devices through the router, coloured by network, with a « schéma › » link (`more`).
- New `igor-wifi-scan-card` and admin-only service `nives.wifi_scan`: the Wi-Fi networks around, heard by each OpenWrt radio when « scanner » is pressed (a radio may pause a second or two): the channels in use per band, then each network's name, BSSID, band and channel, signal and security (open ones in red); the access points' own networks are left out. The rpcd ACL needs `scan` added to `iwinfo` (DOCS.md).
- `igor-map-card`: `big: true` for the middle of a page: the map takes the height, the top countries and the chosen country's detail float over it.
- `igor-dns-card` and `igor-wifi-card`: `more: /a-page` adds « tout le journal › » / « voisins › »; `rows` can go down to 5.
- The theme's swipe goes through the tabs only (a subview, reached by a button, is left out) and never starts on the network map, where a finger moves devices.
- The wall's status bar starts with Igor's eye and name, then the dashboard's pages as tabs, the one shown underlined in red (subviews and hidden views left out; `tabs: false` to remove them). A wall may have a bar without machines (`bar: {}`), for a tablet. Headings get a small red mark.

## 0.30.2 — Names everywhere, the map downloads

- The world map's IP databases failed to download (« Compressed file ended before the end-of-stream marker »): the file was cut at the first chunk received. Downloads (and the news feeds) now read the whole body. The map retries by itself within six hours, or at once after a restart.
- One inventory of the network for every card: OPNsense's DHCP leases and ARP table (read a minute at a time), Home Assistant's device trackers, and a new `names:` in the `nives:` block, by MAC or IP (`names: { "AA:BB:CC:DD:EE:FF": Téléviseur, 10.45.10.100: vm-docker }`), which wins over everything. The DNS card and the world map show those names instead of addresses, the Wi-Fi card instead of MACs.
- The network map says what it could not read (`notes`), e.g. DHCP leases refused by the key's privileges. More DHCP and ARP endpoints are tried (ISC `searchLease`, Dnsmasq, `getArp`).

## 0.30.1 — OpenWrt over plain http

- The Wi-Fi card no longer follows an access point's redirect from http to https (LuCI's `redirect_https`), which failed on port 443 when the access point has no certificate; it now says so: set `uhttpd.main.redirect_https` to `0` on the access point, or give the https address.

## 0.30.0 — The network map

- New `igor-netmap-card`: who talks to whom through the router, live. OPNsense in the middle, the house's devices around it coloured by network (VLAN), the internet's operators outside (Google, Cloudflare…, from the world map's IP databases; else one « internet »). A link's width follows its traffic and dots run along it from the side that opened the connection (`animate: false` keeps it still). A tap on a device shows its address, MAC, network, Wi-Fi network and signal, maker and connections with their services (https, dns, mqtt, smb…) and volume; without a choice, the biggest exchanges.
- New admin-only service `nives.net_map`: reads OPNsense's firewall states, ARP table and DHCP leases (Kea, ISC or Dnsmasq, whichever answers) with a key of its own under `opnsense:` in the `nives:` block. A state seen on both sides of the router (NAT, also behind an ISP box) counts once; the smaller operators fold into « internet ». Names come from DHCP, ARP, Home Assistant's device trackers and the OpenWrt access points. DOCS.md shows how to create the read-only key.
- Only what crosses the router is seen: between networks and to the internet.

## 0.29.0 — Who is on the Wi-Fi

- New `igor-wifi-card`: per Wi-Fi network of your OpenWrt access points, its band, channel and devices, each with its signal (four bars, green to red), link rates down and up and how long it has been connected. `names:` names devices by MAC, `ssids:` keeps only some networks; several access points are shown one under the other.
- New admin-only service `nives.wifi_clients`: reads each access point through ubus (`iwinfo` devices, info and assoclist, `luci-rpc` getHostHints) with a read-only rpcd login, re-logging when the session expires; client interfaces (a repeater's uplink) are left out. Names come from the access point, else from Home Assistant's device trackers by MAC.
- Access points go in the `nives:` block of `configuration.yaml` under `openwrt:` (`url`, `username`, `password`, optional `name` and `verify_ssl`). DOCS.md shows how to create the read-only login on OpenWrt.

## 0.28.0 — The world map

- New `igor-map-card`: where the house's connections go over the last `minutes` (15 by default). Each DNS answer is placed by country and named by its operator (Google, Amazon, Cloudflare…); an arc from home to each country, its width by the number of answers, flowing dashes (`animate: false` to keep it still). The list ranks the countries; a tap on a country or its line shows its devices, operators and domains, and without a choice the blocked queries per device.
- New admin-only service `nives.dns_map` (reads AdGuard Home's log like `nives.dns_log`, up to 3,000 lines). Addresses are located on the Home Assistant host with DB-IP's free « lite » databases (country and operator, about 18 MB, CC BY 4.0), downloaded into `.storage/nives_geo` on first use and refreshed monthly; nothing is sent anywhere to be located. The `maxminddb` reader is installed on first use too. The world outline comes from Natural Earth (public domain).
- Big networks answer from servers near the house: much stays in France even for a foreign service; the operator says who it is.

## 0.27.0 — DNS queries, live

- New `igor-dns-card`: AdGuard Home's DNS queries as they come, read every two seconds (`interval`) through Home Assistant's AdGuard integration (`nives.dns_log`, nothing more to configure). Each line: time, device, domain, response time or « cache »; blocked queries struck through in red with the reason and the rule, rewrites in cyan. A « bloquées » filter, a pause, a search, the chattiest devices as chips (a tap filters on one) and the last minute's rate and share blocked. Device names come from AdGuard, else from Home Assistant's device trackers (their `ip` attribute), else from the card's `names: { 192.168.1.20: nas }`; `hide: [in-addr.arpa]` leaves out noisy domains.
- `nives.dns_log` is for administrators only (the log is the house's browsing history) and keeps nothing. Restart Home Assistant after updating.

## 0.26.0 — Music on the wall

- New `igor-music-card`: what plays (cover, title, artist, progress), previous / play-pause / next, shuffle, volume, the choice of speaker (`players`), one-tap `favorites`, and with Music Assistant what comes next (`music_assistant.get_queue`) and a search whose results play on a tap (`music_assistant.search`, `music_assistant.play_media`). Works with any media player; the Music Assistant parts stay quiet without it.

## 0.25.0 — Igor's own look

- `igor-facts-card`: a row may count instead of showing one state, `{ name, count: [ids] }` → « 2 / 5 » lit (for a wall's « état » card without switches).
- Igor stands for **Intelligent Governance & Operations Relay**.
- New themes « Igor » and « Igor (tablette) »: near-black, bone white, cyan for data, amber for what is lit, the signal red for the selected page and errors; square corners, thin lines, no shadow; titles in Chakra Petch where the device has it, a monospace face elsewhere. « Igor Journal » stays.
- New logo, the eye: a monolith pierced by a red eye (integration brand, light and dark, and the add-on's icon and logo).
- While the key is away, `allowed_users` in the `nives:` block (names or ids) are still answered: the owner from a phone, never the wall, the tablet or a voice satellite (they carry no user).

## 0.24.1 — The locks in configuration.yaml

- The key, the alarm, the alarm in progress and the disarm code can also be set in `configuration.yaml` (Igor's options win when both are set):
  ```yaml
  nives:
    key_entity: binary_sensor.usb_key
    alarm_entity: input_boolean.alarm
    alarm_active_entity: binary_sensor.alarm_triggered
    disarm_code: !secret igor_disarm_code
  ```
  The code (4 to 12 digits) is hashed at start-up and never kept in memory as such.

## 0.24.0 — The house's locks

- Igor's options (Settings → Devices & services → Igor → Configure): the **key** (a binary sensor, e.g. a USB key's presence), the **alarm** (input_boolean, switch or alarm panel), the **alarm in progress** sensor and a **disarm code**. The code is never stored: only a salted PBKDF2 hash.
- While the key is away (off, unknown or unavailable), Igor refuses every request, spoken or typed, and fires an `igor_security` event.
- `nives.disarm` (code): turns the alarm off; five wrong codes in ten minutes refuse every try for ten minutes; each wrong code fires `igor_security` and a notification.
- Desk screen (igor-ear 0.4.0, `[screen] key_entity`, `alarm_entity`, `camera`): a guard window of its own, above the dashboard and not part of it, while the key is away (« VERROUILLÉ ») or the alarm goes off (« INTRUSION », red): the camera and a keypad that sends the code to `nives.disarm`. The kiosk's exit shortcut is off while it is up; if the window cannot show, swaylock locks the session. Rerun `ear/screen/install-vm.sh` (it installs swaylock).
- Wall tablet: two fixed pages, `/nives_static/verrou.html` and `/nives_static/alerte.html` (red, nothing to touch), for Home Assistant to load through the Fully Kiosk integration.

## 0.23.15 — The tablet shows the whole exchange

- A tablet tied to one satellite (`?igor_tablet=assist_satellite.…`) ignored every turn whose satellite is unknown (the voice sensor says `None`): it showed the name heard, then nothing. Such turns now show. And a quick local turn that goes from « heard » to « done » between two looks is shown whatever step the display last saw.

## 0.23.14 — No empty « transcription »

- With two Igor entries in Home Assistant (an old one left behind), the tablet followed the old entry's voice sensor: « heard » reached it, the turn itself only the working one, so the display stayed on « transcription ». The tablet and the wall cards now follow the voice sensor that moved last.
- When the name is heard and nothing reaches Igor within 15 s (30 s while it waits for an answer), the display says « rien reçu · sans suite » and leaves, instead of holding an empty « transcription » for two minutes.

## 0.23.13 — The tablet's live display, tidy

- The live display when the name is heard was broken by 0.23.8: the ear's line spread over the screen's width, everything sat at the bottom, and the bar and chips were not aligned with the words. It is now centred, the ear's line reads « oreille · nom entendu », a blinking cursor holds the place of your words while they are transcribed, and the time bar and chips line up under them.

## 0.23.12 — Dépêches that stay

- Dépêches: the feed is fetched twice before giving up (a site sometimes answers a busy page once), with a browser-like request; a failure shows the last good list instead of « Flux indisponible »; with nothing yet, the card tries again every 30 s instead of waiting ten minutes.

## 0.23.11 — The tablet's page repairs itself, surely

- The repair of a page drawn before the cards' script arrived looks deeper into the page, also notices a wall page with no wall drawn at all (whatever Home Assistant shows instead), and reloads after 3.5 s (at most every 30 s) instead of 7 s.

## 0.23.10 — Swipe between tabs

- Theme « Igor Journal »: a finger swipe left or right goes to a dashboard's next or previous tab (not on a slider, a map or a text field, nor while editing).

## 0.23.9 — The tablet's page repairs itself

- Theme « Igor Journal » (phone, PC, tablet): no « ☰ » button in the dashboards' top bar and no docked sidebar; the view tabs stay, and a wall's « Menu » button still opens the sidebar. Back with `?menu` in the address or while editing.
- A dashboard drawn before the cards' script arrived (a slow tablet: the whole page « Erreur de configuration ») repairs itself: its error cards are rebuilt once the script is here, and the page reloads if one remains (at most once a minute).

## 0.23.8 — A cleaner journal, whole names on the tiles

- Igor's journal (the tablet's history, its live display when the name is heard, and the walls' journal card): one row per exchange with the time, the words (two lines, a tap for all), Igor's answer under a rule, what was done as chips named as in the house (« Salon · éteint », not the entity id; a scene's timestamp reads « activée »), failures in red, the route (local, en ligne, échec) and the total time; the steps as one coloured time bar with a short legend, the full calls on a tap. The history opens on the day's four figures and filters (tout, actions, réponses, échecs), newest first.
- `igor-tiles-card`: a long name goes on two lines instead of being cut (« Projecteur »).

## 0.23.7 — A key wakes the desk screen

- Desk screen (igor-ear 0.3.4): asleep, a key or the mouse wakes it (swayidle in the kiosk session), and `sensor.igor_screen` follows the output's real state, however it was switched. After a minute without a key or the mouse, its `idle` attribute turns true, so an automation can put it back to sleep. Rerun `ear/screen/install-vm.sh` on Igor's machine (it installs swayidle).
- Igor's ear waits up to 90 s for whisper-server at start (it loads its model on the graphics card after the ear starts at boot) instead of staying on the CPU until the next restart; its service starts after whisper-server. Reinstall with `ear/install.sh` or copy `igor-ear.service` again.
- The walls' journal was empty with an old Igor entry left in Home Assistant (an add-on that is gone): `nives.journal` stopped at that entry's error. It now tries every entry until one answers.
- Wall bar: `tap: /a-page` opens that page (the homelab) on a tap instead of the machines' detail.
- `igor-tiles-card`: a last row short of tiles no longer leaves a hole; its last tile widens to the end.
- `igor-tiles-card`: a lit light's tile (border, icon and background) takes the light's colour; `invert`, `icon_off` and `text` for a tile lit while its entity is off (a camera's privacy switch: grey and crossed out while private).
- Tablet overlay: the steps' column is wider, so « destinataire » no longer runs into its detail.

## 0.23.6 — The keyboard switch, headlines, the wall's panels

- Wall bar: « igor » (top left) opens Igor's panel (the satellite, listening on or off, the graphics card, today's exchanges, the last conversations, buttons to open them, talk or stop listening); the clock (top right) opens a time panel (sunrise and sunset, week, chosen entities, a timer's 5/10/20/60 min buttons, the screen's sleep). Both under `bar: panels:`. The machines' detail now closes with its « fermer » only, no longer on any tap.
- `igor-assist-card`: a second press while Igor listens, thinks or answers cancels the conversation (the satellite's « satellite enabled » switch off for a moment, or `cancel_switch`).
- `igor-buttons-card`: `journal: true` opens Igor's conversations over the page, on any device.
- With the tablet theme, every other page (energy, history, lists, Igor's panel, another dashboard) shows a « ‹ mur » button in the bottom left corner that goes back to the wall.
- New `igor-facts-card`: a few states, one line each, coloured by `ok`, `warn`, `bad`; a row whose entity is missing is left out.
- Desk screen (igor-ear 0.3.3): a USB sound card counted as a keyboard (it declares its volume keys), so the keyboard never seemed to leave and the USB switch did not move the screen. Only a device with letter keys and a space bar counts now, on Igor's machine and on the PC (`igor-screen-pc`). The screen moves only after 3 seconds without the keyboard: a long USB link that drops it for a moment does not flip the screen. Pull the sources on both.
- With the tablet theme, Home Assistant's top bar is hidden only on pages that show an `igor-wall`: another dashboard opened from a wall button (one with several tabs) keeps its tabs.
- New `igor-news-card`: the newest headlines of an RSS or Atom feed (`url`), read by Home Assistant (`nives.news`, kept ten minutes) and refreshed every ten minutes; a tap opens the article on a PC. With `url: https://www.mediapart.fr/journal/fil-dactualites` it shows the AFP's dispatches as Mediapart publishes them (that page has no feed). Restart Home Assistant after updating.

## 0.23.5 — New cards reach every screen

- The cards' script kept the same address since 0.23.0, so browsers and the companion app could keep running an old copy: cards added since (`igor-tiles-card`, `igor-control-card`, `igor-clock-card`, `igor-alerts-card`…) showed « Custom element doesn't exist ». Each frontend script's address now carries a digest of its content, so any change is loaded fresh. Restart Home Assistant after updating.

## 0.23.4 — Fullscreen again, times as times

- The kiosk's Chromium is fullscreen again (its own bar showed): it leaves fullscreen only while a settings window is open, and igor-screen (igor-ear 0.3.2) puts it back once none is left, however it was closed.
- Wall cards: a time given as « 2026-11-01 18:31:50+01:00 » shows as « 18:31 »; small tiles no longer let their state run over the name; big tiles with smaller icons, beside the name; the weather card asks for the forecasts by the service when the subscription brings none.

## 0.23.3 — The desk screen stops reloading

- The kiosk page reloaded every few seconds: `kiosk.sh` outlived its session (logind keeps a closed session's processes), so each restart of greetd added one more; a second Chromium on the same profile hands its address to the one on screen, which reloads the page. `kiosk.sh` now runs once (a lock) and stops with its sway session. Rerun `ear/screen/install-vm.sh` on Igor's machine.

## 0.23.2 — A tablet and a phone

- Cards for a simple tablet page and a phone admin dashboard: `igor-tiles-card` (large buttons: scenes, lights, media…), `igor-control-card` (a device and its buttons), `igor-clock-card`, `igor-alerts-card` (what is wrong, first, with a summary); `igor-weather-card` without its clock (`clock: false`), `igor-assist-card` with a microphone button (`size: big`). The Proxmox and Docker cards fold into one column on a phone.
- Desk screen: the kiosk starts without the page's stored service worker, which could keep Home Assistant's old frontend after an update and reload the page endlessly. Rerun `ear/screen/install-vm.sh` on Igor's machine.

## 0.23.1 — The homelab page

- New wall cards for a second page of the desk screen: `igor-proxmox-card` (the node, each VM and container, storages, ZFS pools and disks, found from the Proxmox VE integration's devices), `igor-docker-manage-card` (Portainer's totals, clean-up, and each container's buttons, found by device so a button never acts on another container; recreate, stop and clean-up need a second press) and `igor-history-card` (sensors over the last hours).
- The status bar's detail can link to other pages (`links`); a wall with `home: false` is not the one the screen comes back to.
- Desk screen (`ear/screen/install-vm.sh`): greetd's fallback session is the kiosk too, so restarting greetd brings the dashboard back; before, it fell to a login prompt that looped into a black screen. The kiosk's Chromium now runs at low priority, capped near one core and 1.2 GB, drawn by the graphics card with at most two page processes, so Igor, Whisper and the sound keep the machine. Rerun the script on Igor's machine.

## 0.23.0 — The wall, reworked for the desk screen

- The journal was empty on the wall: voice exchanges are kept under the speaker's Home Assistant user, and the integration read its own. The server's `GET /api/journal` now returns the whole house's, which `nives.journal` reads (integration 0.1.20).
- New wall cards: `igor-weather-card` (now, hour by hour, days as temperature bars; the forecast stands in when the current state is unavailable), `igor-assist-card` (Igor's state, tap to talk, hold or pill to switch it), `igor-buttons-card` (a row of small buttons: a service, a page such as the settings, or the sidebar; with the tablet theme the screen comes back to the wall after 5 minutes untouched elsewhere), `igor-alarm-card` (an Alarm Clocks alarm on one line, its full card on tap) and `igor-mini-card` (a sensor and its 24 hours on one line).
- The network card shows the router's gateways and its busiest interfaces (`gateways: auto`, `interfaces: auto`); the Docker card leaves out removed containers and no longer overlaps its columns; the energy card keeps a small chart unless it is the one that grows; the status bar's detail is a table of the machines with the router and disks listed beside it (`side: true`).
- `nives.screen`: the desk screen's orders as a service any user can call (a dashboard button), where firing the `igor_screen` event needs an administrator.
- Igor Journal theme: Mushroom cards more compact (icons, text, spacing).

## 0.22.2 — The VM's settings from the dashboard

- igor-ear 0.3.1 (`ear/`): the desk screen's kiosk session now starts EasyEffects and Bluetooth's agent itself (what an XFCE session did), and `install-vm.sh` switches off the login manager in place (LightDM…) before enabling greetd. Home Assistant's `igor_screen` event takes `app` (`sound`, `equalizer`, `bluetooth`) to open pavucontrol, EasyEffects or Blueman over the dashboard, and `close`.

## 0.22.1 — Igor's desk screen

- igor-ear 0.3.0 (`ear/`, update it on its machine): Igor's machine can show the wall dashboard on its graphics card's output, on a monitor shared with your PC (`ear/screen/`). `install-vm.sh` sets up a kiosk session at boot (sway, Chromium full screen on the dashboard, no password with Home Assistant's trusted networks) and `run.sh screen`: the machine that loses the USB keyboard sends the monitor to the other input (DDC/CI), and Home Assistant's `igor_screen` event (`pc`, `dashboard`, `off`, `on`, `toggle`) switches it or puts it to sleep; its state is `sensor.igor_screen`. `install-pc.sh` gives the PC (Fedora Silverblue/secureblue or any GNOME) its keyboard watch and an **Igor** icon in the dock.
- Wall cards (integration 0.1.19): `?igor_theme=<theme>` in the address picks the theme for that device (a kiosk without a keyboard), and with the tablet theme Home Assistant's sidebar is hidden too.

## 0.22.0 — The wall dashboard

- Wall dashboard cards (integration 0.1.18): `custom:igor-wall` fills a tablet's screen exactly, columns of cards down to the bottom (`grow: true` for the card that takes the height left), under a one-line status bar that scrolls slowly through the machines (Proxmox host and VMs, Docker, router…, each figure amber or red past its threshold; a touch opens the detail of all). With it, cards in the theme's style: `igor-journal-card` (Igor's last exchanges and today's figures), `igor-docker-card` (Portainer's containers), `igor-net-card` (a router's traffic over the last hour), `igor-energy-card` (power hour by hour today) and `igor-camera-card` (a picture refreshed every few seconds). Written for old tablets: one animation, no timer under a second, history read once a minute.
- The floating **journal** button is gone: the journal card's « historique » opens the history, on any device.
- New theme **Igor Journal (tablette)**: the same without Home Assistant's top bar, for the tablet only; it comes back while editing (`?edit=1`) or with `?barre` in the address.
- igor-ear 0.2.5 (`ear/`, update it on its machine): sends its AMD graphics card's load, temperature and video memory to Home Assistant every 30 s (`sensor.igor_ear_gpu_*`, `[machine]` in its settings).

## 0.21.10 — Your cards in Igor's colours

- Igor Journal theme: the named colours cards use (Mushroom's `green`, `amber`, `blue`, `red`, `pink`, `yellow`…, tile cards too) now take Igor's palette in both modes, so an existing dashboard follows the theme without being edited.
- Wall tablet: a dashboard card can open the journal's history with the action `{action: fire-dom-event, igor_journal: true}` (integration 0.1.17). Restart Home Assistant once after updating.

## 0.21.9 — The Igor Journal theme, and the journal's history

- A Home Assistant theme in the style of the wall tablet's journal: dark grey, thin lines, small corners, a monospace face everywhere (the device's own, nothing downloaded), green for what is on, amber for warnings, Igor's blue as the accent, and a light version (Auto follows the device). The add-on installs it in `/config/themes/igor-journal.yaml` and reloads Home Assistant's themes; `configuration.yaml` needs `frontend: themes: !include_dir_merge_named themes` once (the add-on's log says when it is missing). Then Profile → Theme → Igor Journal.
- Wall tablet: a small **journal** button in a corner opens the history, Igor's last 100 spoken exchanges by day, each with your words, its steps (local or online, with their times), what was done and the answer. A new request takes the screen back. The server keeps the newest 1,000 exchanges in `voice-journal.jsonl` next to its database (GET `/api/journal/<user>`), and the integration (0.1.16) hands them to the tablet through a new `nives.journal` service. Restart Home Assistant once after updating.

## 0.21.8 — The tablet's journal

- Wall tablet: while Igor works it shows a plain terminal journal instead of the eye: your words, each step of the local model (the local model's time, each Home Assistant call with its entity, then "rien envoyé" or the online model and its time), each marked local or online, what was done, and Igor's answer as it is written. One solid background, no blur, no glow, nothing animated but a cursor: light enough for an old tablet. The tablet's microphone is no longer used.
- The server returns this trace with every local turn, and the integration (0.1.15) keeps it on the voice sensor (`trace` attribute, not recorded). Restart Home Assistant once after updating.

## 0.21.7 — A silent order is remembered as done

- An order the local model carried out in silence ("active la scène tamisée") is now kept in the conversation as done ("Scène tamisée activée."), though never said. Before, only the request was kept, unanswered: at the next spoken answer Mistral read it in the last exchanges and announced that the scene could not be activated. Mistral is also told to answer only the last message, never to come back to an earlier request.
- igor-ear 0.2.4 (`ear/`, update it on its machine): with `[media] when_media = "closed"` the ear reopens about 0.4 s after the sound stops (`sound_hold`, 0.3 s), and `[media] watch_source` reads the television where it comes in (the sound card's input), so only its signal counts.

## 0.21.6 — The eye, all the way through

- Wall tablet: Igor's eye replaces the bow tie in every phase (the bow tie stays, etched in the iris). Each phase has its own look: the iris opens at the name and breathes while Igor listens; it draws in to a bright point with one racing arc while the words are transcribed; it narrows and pulses, circled by two counter-turning arcs, while Igor thinks; it opens wide and pulses as it answers; it settles half open when done; it dims and flickers on an error.
- The iris follows the voice in the room while Igor listens to you and while it speaks, from the tablet's own microphone: a loudness measured in the browser, never recorded or sent, used only while the display shows (the microphone is let go a minute after). The tablet asks for microphone permission the first time; some browsers also need one touch on the screen. `?igor_tablet_mic=0` turns it off; without it the iris keeps its own animations. Integration 0.1.14.

## 0.21.5 — Igor's eye

- Wall tablet: while Igor listens (its name heard, or waiting for your answer), the bow tie gives way to Igor's eye, a black glass lens in a steel ring whose blue iris opens at its name, then breathes; the bow tie is etched in its centre. Thinking and answering keep the bow tie. Home Assistant loads the new display after the restart it asks for (integration 0.1.13).
- igor-ear 0.2.2 (`ear/`, update it on its machine): Igor no longer answers the end of its own words, heard when the ear reopened in a pause of its voice; the ear waits for 0.8 s of quiet, not 0.3 s, before reopening. A stricter ear while a television sounds is available as `[media] when_media = "strict"` (the name must be heard by Whisper; the listening windows take only an order, a question or a short answer); `"name"` keeps the behaviour it had.

## 0.21.4 — Faster spoken answers, a faster ear

- New option `voice_reply_model`: with the local model, the online model that words what Igor says aloud (answers, readings, confirmations). A smaller one (`mistral-medium-latest`, `mistral-small-latest`) answers sooner; the chat panel and everything else keep the main model. Empty = the main model, as before.
- igor-ear 0.2.0 (`ear/`, update it on its machine):
  - `[stt] server`: the name is heard by whisper.cpp's `whisper-server` on the machine's GPU, any GPU, AMD included, instead of faster-whisper on the CPU (it only knows NVIDIA cards).
  - Igor's answer is said a sentence at a time while it is still being written, instead of once whole.
  - The journal says how long Igor took to answer and when its first sentence went out; a silent order is no longer called "not for Igor"; `run.sh report` works again. The README advises Home Assistant's local address: a public name made each sentence leave the house, and cost one install 5 seconds a sentence.

## 0.21.3 — Silent orders stay silent

- An order the local model carries out without a word ("allume le salon") no longer makes Home Assistant say "I received your request but got no response.": the server marks the empty reply `silent`, and the integration (0.1.12) says nothing, as for a sentence not said to Igor. Restart Home Assistant once after updating so it loads the new integration.
- Training (`ear/tools/llm-train`): `train.sh` hands the model, `eval.json` and `train.log` straight to the VM (`runpodctl send`, step 7) and stops the pod only once they are received; a pod restarted without a GPU can come back empty. The card is checked with a real computation, and a broken rented machine (Error 802 on SXM cards, a PyTorch too old for Blackwell) is named as such.

## 0.21.2 — Scripts that answer, Shield, account numbers

- A script that returns something (Tasker scripts acknowledge every action) no longer makes the local model read its answer again once it has written its line: "mode avion" is one pass. The two-step calendar, written without a line on its first pass, still reads the converted dates.
- `local_llm_prompt.fr.txt`: the Shield scripts (launch an app, press a key), and the calendar script's `recipent` field as the script spells it.
- A name carrying a long number (an account number, a serial) counts as technical: it never appears in everyday examples.
- Phrasebook: a script with fields and no entity (`script.shield_lancer_app {"app": "netflix"}`) is read correctly.
- Phrasebook: your phrases win. A generated request with the same words as one of yours ("éteins tout") is dropped, so the model learns only your answer (`scene.eteindre`).

## 0.21.1 — The phone, the silent way

- Calls and texts with the silent local model: it finds the contact and hands over (`>demande`); Mistral reads the name, the number and, for a text, the proposed message back ("Jean Martin, sur son mobile au 06…, je l'appelle ?"); on "oui" the local model runs `script.appeler` or `script.envoyer_sms` with the confirmed number and text. "Non" leaves it there.
- The training set teaches these flows, the timer (`script.minuteur`, seconds, announced), the phone modes (plane, do not disturb, vibrate, ring, media) and the notifications, whenever the house has those scripts (made-up contacts).
- A ready `local_llm_prompt` for these scripts, technical and on one line: `ear/tools/llm-train/local_llm_prompt.fr.txt`.

## 0.21.0 — Your own words in the training set: aliases and a phrasebook

- The aliases you give a device for Assist (Settings → Voice assistants → Expose → the entity → Aliases) are now its preferred names in the training set: "aspirateur", "robot" on the Dreamebot, and the model learns to say it your way.
- Phrasebook: write your own phrases in `igor-phrases.txt` in Home Assistant's config folder, one per line, `phrase => action` (`passe l'aspirateur => vacuum.start vacuum.dreamebot`, `il fait combien dehors => get_state sensor.temperature_exterieure`, `qui a gagné le match => web`). Each one is trained three ways; a sixth is held out for the bench. Lines that cannot be read are listed in `phrases-erreurs.txt` in the zip.
- The zip lists the devices the training set knows in `appareils.txt` (id, name, room, aliases), to write the phrasebook from.
- The zip also holds `maison.json`, everything the training set is built from (devices, rooms, aliases, light capabilities, your `local_llm_prompt` rules, the scripts section), so it can be built elsewhere: `npx tsx src/train/build-from-house.ts maison.json [igor-phrases.txt] [out.zip]`.

## 0.20.1 — "Lance l'aspirateur", not "allume le Dreamebot"

- Training set: a device the house has only one of gets its everyday name too ("l'aspirateur", "le robot", "le chauffage", "la serrure", "la tondeuse", "le chauffe-eau"), and the vacuum starts, docks and stops in those words.
- A name Home Assistant built by repeating the device's ("Dreamebot L10 Prime Dreamebot L10 Prime") is said once.
- A name no one says whole (over 45 characters, or with brackets or a colon: "Météo-France forecast for city Paris (75)…", "Disk pve: Samsung SSD…") counts as technical: read when asked by its full name, never in the everyday examples.
- Scenes: "active / lance / déclenche la scène …", no more "mets l'ambiance éteindre". "Tablette" is feminine.

## 0.20.0 — The training set learns from real requests and real use

- Every request the local model handles is kept on the house's disk (`/data/local-turns.jsonl`, 5,000 newest): the words, the exchange before them, what it did and whether it worked. A request followed within two minutes by "non, l'autre…", "annule" or "c'est pas ça" marks the one before as corrected. Option `local_turn_log` (on by default).
- The training set replays the real requests that worked and stood, exactly as the model read them, twice each next to the generated ones; a sixth of them is held out in `test.jsonl`, the truest bench. Those that failed or were corrected are listed in `a-revoir.txt`, not trained on.
- Usage weighting: the devices a person switched over the last 30 days (Home Assistant's logbook, entries carrying a user, plus the voice requests) get more examples; a light used daily comes up about six times as often as one never touched.

## 0.19.2 — Faster training that stops by itself

- Training (`ear/tools/llm-train`): one epoch by default; Liger Kernel when it installs (the loss without the full logits, four examples per step on a 24 GB card); on RunPod the machine stops by itself a minute after the end, success or failure, with the model kept on its disk (`AUTO_STOP=0` to keep it running). `eval.json` lists, for each miss, the words, the expected answer and the model's.
- Training set: "la lumière du salon" now always means one light (room-wide orders say "les lumières", "toutes les lumières" or "tout"), and scenes are no longer called "mode …", which helpers like "Mode cinéma" use. The score counts `>web` and `>libre` alike: both hand the question to Mistral, which searches when it needs to.

## 0.19.1 — A training set that sounds like the house

- Entities whose name carries a machine id (`browser_mod_c8a993dd…`, `navbar 6926f9e4…`) are left out of the training set: nobody can say them. The add-on log says how many.
- Interface helpers (Material You, browser_mod, themes) count as technical: switched by their full name, never given a room's words.
- What is said every day comes up most: in orders and state questions, a light is picked 60 % of the time, a plain switch 30 %, a helper (`input_boolean`) 10 %; technical readings are fewer.
- Containers and stacks start and stop ("démarre le conteneur", "arrête la stack") instead of "allume". A state with no unit is asked as "quel est l'état de…", not "c'est combien".
- "Voiture — annonces vocales" is said without the dash; "voiture" is feminine.
- Training tools (`ear/tools/llm-train`): one example per step by default, so a 24 GB card no longer runs out of memory.

## 0.19.0 — The local model is the house, Mistral is Igor's voice

- The local model now decides whether Igor speaks. After acting, it writes one line: `-` (nothing to say), `>dire` (announce what was done), `>rep` (answer from what it read), `>web` (needs the internet), `>libre` (general knowledge, conversation) or `>demande` (something is missing). A plain order is carried out in silence by default; a failed order or a confirmation to ask is always said.
- Mistral gets a terse brief instead of the full tool results: the tag, `fait :` and `lu :` lines as entity=state, and the person's exact words, plus the last exchanges. Its instructions tell it how to read that brief and speak as Igor.
- The local model's prompt is now technical and minimal (the protocol in a few lines, short tool descriptions); its sampling is near-greedy (temperature 0.1), as it writes ids and JSON.
- `local_order_reply` now applies when the local model has nothing to say; its default is `silent`.
- Training set: built from the whole house by default (button "toute la maison", nothing to expose), or from the exposed entities only. Its size grows with the house (8 examples per device, 4,000 to 20,000), the zip is compressed and downloaded by the browser, nothing is kept on the server. Every example ends with the right line. Every entity can be driven: what is about a device rather than the house (diagnostic and configuration entities, hidden ones, batteries, signal, CPU load, indicator lights…) is read when asked and switched by its full name, and never takes a room's words ("la prise du salon") from a real device. Groups get the room's words, their members keep their own names. Readings the model was not trained on are searched for. More feminine nouns and accent-aware contractions in the examples and the short order sentences.
- With a tuned model (`local_llm_tuned`), turn off `tools_from_exposed` for it to drive every entity.

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
