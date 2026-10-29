/**
 * Home Assistant service names as models get them wrong. A small model wrote
 * cover "open" and "set_position", which Home Assistant refuses (400); the
 * real names are open_cover and set_cover_position. Only names that are not
 * services of that domain are mapped, so a real service is never changed
 * ("open" is a real lock service).
 */
const ALIASES: Record<string, Record<string, string>> = {
  cover: {
    turn_on: "open_cover",
    turn_off: "close_cover",
    open: "open_cover",
    close: "close_cover",
    stop: "stop_cover",
    set_position: "set_cover_position",
    position: "set_cover_position",
    set_tilt: "set_cover_tilt_position",
    set_tilt_position: "set_cover_tilt_position",
    open_tilt: "open_cover_tilt",
    close_tilt: "close_cover_tilt",
  },
  media_player: {
    play: "media_play",
    pause: "media_pause",
    stop: "media_stop",
    next: "media_next_track",
    next_track: "media_next_track",
    previous: "media_previous_track",
    previous_track: "media_previous_track",
    play_pause: "media_play_pause",
    set_volume: "volume_set",
    volume: "volume_set",
    mute: "volume_mute",
  },
  climate: {
    set_temp: "set_temperature",
    set_mode: "set_hvac_mode",
  },
  fan: {
    set_speed: "set_percentage",
  },
  light: {
    on: "turn_on",
    off: "turn_off",
  },
  switch: {
    on: "turn_on",
    off: "turn_off",
  },
};

/** The service Home Assistant knows for what the model wrote. */
export function canonicalService(domain: unknown, service: unknown): unknown {
  if (typeof domain !== "string" || typeof service !== "string") return service;
  return ALIASES[domain]?.[service] ?? service;
}
