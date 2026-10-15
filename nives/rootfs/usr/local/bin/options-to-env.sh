#!/usr/bin/env bash
# Maps /data/options.json (HA add-on config) to environment variables
# that home-mind-server's loadConfig() expects.
# Writes to /var/run/s6/container_environment/ so all s6 services inherit them.

set -eo pipefail

S6_ENV_DIR="/var/run/s6/container_environment"
OPTIONS="/data/options.json"

write_env() {
    local name="$1"
    local value="$2"
    if [ -n "$value" ]; then
        printf '%s' "$value" > "${S6_ENV_DIR}/${name}"
    fi
}

# Secrets below are created owner-only from the start, rather than world-readable
# until the chmod further down.
umask 077

# Generate Shodh API key on first run
if [ ! -f /data/.shodh_key ]; then
    openssl rand -hex 32 > /data/.shodh_key
fi

SHODH_KEY=$(cat /data/.shodh_key)

# Generate the add-on's own API token on first run.
#
# Without this the server's auth middleware stays dormant and port 3100 is wide
# open to anything that can reach the container: /api/chat can drive Home
# Assistant, and DELETE /api/memory/:userId wipes everything the user has taught
# it. The token is persisted in /data so it survives restarts and updates — the
# companion integration receives it via the Supervisor discovery message, so
# there is nothing for the user to copy or configure.
if [ ! -f /data/.api_token ]; then
    openssl rand -hex 32 > /data/.api_token
    echo "[init] Generated a new API token for the MaDo server"
fi
chmod 600 /data/.api_token /data/.shodh_key 2>/dev/null || true

API_TOKEN=$(cat /data/.api_token)

# Read options (BYOK provider settings)
LLM_PROVIDER=$(jq -r '.byok.provider // "anthropic"' "$OPTIONS")
LLM_API_KEY=$(jq -r '.byok.api_key // ""' "$OPTIONS")
LLM_MODEL=$(jq -r '.byok.model // ""' "$OPTIONS")
LLM_BASE_URL=$(jq -r '.byok.base_url // ""' "$OPTIONS")
CUSTOM_PROMPT=$(jq -r '.custom_prompt // ""' "$OPTIONS")
CUSTOM_PROMPT_VOICE=$(jq -r '.custom_prompt_voice // ""' "$OPTIONS")
CUSTOM_PROMPT_THREAD=$(jq -r '.custom_prompt_thread // ""' "$OPTIONS")
ASSIST_MODE=$(jq -r '.assist_mode // ""' "$OPTIONS")
THREAD_MEMORY=$(jq -r '.thread_memory // ""' "$OPTIONS")
SPEECH_TO_TEXT=$(jq -r '.speech_to_text // "auto"' "$OPTIONS")
MISTRAL_API_KEY=$(jq -r '.mistral_api_key // ""' "$OPTIONS")
MAX_OUTPUT_TOKENS=$(jq -r '.max_output_tokens // ""' "$OPTIONS")
REASONING_EFFORT=$(jq -r '.reasoning_effort // ""' "$OPTIONS")
THREAD_REASONING=$(jq -r '.thread_reasoning // ""' "$OPTIONS")
TEXT_TO_SPEECH=$(jq -r '.text_to_speech // "off"' "$OPTIONS")
TTS_VOICE=$(jq -r '.tts_voice // ""' "$OPTIONS")
MISTRAL_LIBRARY_IDS=$(jq -r '.mistral_library_ids // ""' "$OPTIONS")
MISTRAL_CONNECTORS=$(jq -r '.mistral_connectors // ""' "$OPTIONS")
OCR_PRICE=$(jq -r '.ocr_price_per_1000_pages // ""' "$OPTIONS")
FAST_MODEL=$(jq -r '.fast_model // ""' "$OPTIONS")
NOTIFY_SERVICE=$(jq -r '.notify_service // ""' "$OPTIONS")
DAILY_BRIEFING_TIME=$(jq -r '.daily_briefing_time // ""' "$OPTIONS")
DAILY_BRIEFING_PROMPT=$(jq -r '.daily_briefing_prompt // ""' "$OPTIONS")
MODEL_PRICES=$(jq -r '.model_prices // ""' "$OPTIONS")
HOUSE_WATCH=$(jq -r '.house_watch // ""' "$OPTIONS")
CONFIG_EDITS=$(jq -r '.config_edits // ""' "$OPTIONS")
WATCH_QUIET_HOURS=$(jq -r '.watch_quiet_hours // ""' "$OPTIONS")
WATCH_MAX_PER_DAY=$(jq -r '.watch_max_per_day // ""' "$OPTIONS")
WATCH_LIVELY_TIME=$(jq -r '.watch_lively_time // ""' "$OPTIONS")
EXTRACTION_MODEL=$(jq -r '.extraction_model // ""' "$OPTIONS")
# `// ""` would turn an explicit "off" into "", so test for null instead.
EXTRACTION_GATE=$(jq -r 'if .extraction_gate == null then "" else .extraction_gate end' "$OPTIONS")
# `// ""` would turn an explicit false into "", so test for null instead.
LAYOUT_FROM_EXPOSED=$(jq -r 'if .layout_from_exposed == null then "" else (.layout_from_exposed|tostring) end' "$OPTIONS")
TOOLS_FROM_EXPOSED=$(jq -r 'if .tools_from_exposed == null then "" else (.tools_from_exposed|tostring) end' "$OPTIONS")
LAYOUT_DOMAINS=$(jq -r '.layout_domains // ""' "$OPTIONS")
MEMORY_TOKEN_LIMIT=$(jq -r '.memory_token_limit // ""' "$OPTIONS")
LOG_LEVEL=$(jq -r '.log_level // "info"' "$OPTIONS")

# --- LLM configuration: bring your own provider key ---
write_env "LLM_MODE" "byok"
# BYOK mode: user provides their own API key
write_env "LLM_PROVIDER" "$LLM_PROVIDER"

case "$LLM_PROVIDER" in
    anthropic)
        write_env "ANTHROPIC_API_KEY" "$LLM_API_KEY"
        ;;
    openai)
        write_env "OPENAI_API_KEY" "$LLM_API_KEY"
        [ -n "$LLM_BASE_URL" ] && write_env "OPENAI_BASE_URL" "$LLM_BASE_URL"
        ;;
    mistral)
        # Mistral's chat endpoint is OpenAI-compatible but rejects some OpenAI-only fields.
        write_env "LLM_PROVIDER" "openai"
        write_env "OPENAI_API_KEY" "$LLM_API_KEY"
        write_env "OPENAI_BASE_URL" "${LLM_BASE_URL:-https://api.mistral.ai/v1}"
        if [ -z "$LLM_MODEL" ]; then
            LLM_MODEL="mistral-small-latest"
        fi
        ;;
    openrouter)
        # OpenRouter is OpenAI-compatible — rewrite provider to openai
        write_env "LLM_PROVIDER" "openai"
        write_env "OPENAI_API_KEY" "$LLM_API_KEY"
        write_env "OPENAI_BASE_URL" "https://openrouter.ai/api/v1"
        ;;
    ollama)
        write_env "OLLAMA_BASE_URL" "${LLM_BASE_URL:-http://homeassistant:11434/v1}"
        ;;
esac

# Model, with a per-provider default when the user leaves it blank.
# Only OpenRouter used to get a default; every other provider fell through to
# the server's own built-in default, which is an Anthropic model id. Pointing
# that at OpenAI or Ollama gets a "model not found" error that reads like the
# add-on is broken rather than like a missing setting.
if [ -n "$LLM_MODEL" ]; then
    write_env "LLM_MODEL" "$LLM_MODEL"
else
    case "$LLM_PROVIDER" in
        openrouter)
            write_env "LLM_MODEL" "anthropic/claude-haiku-4.5"
            echo "[init] No model set — defaulting to anthropic/claude-haiku-4.5"
            ;;
        openai)
            write_env "LLM_MODEL" "gpt-5-mini"
            echo "[init] No model set — defaulting to gpt-5-mini"
            ;;
        ollama)
            echo "[init] WARNING: Ollama has no default model. Set 'Model' in the add-on"
            echo "[init]          configuration to the name you pulled (e.g. qwen3:8b),"
            echo "[init]          otherwise chat will fail with a model-not-found error."
            ;;
        anthropic)
            # The server's built-in default is already an Anthropic model.
            :
            ;;
    esac
fi


# --- Home Assistant (automatic via Supervisor) ---
# SUPERVISOR_TOKEN may be in the s6 container environment or shell env
SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"
if [ -z "$SUPERVISOR_TOKEN" ] && [ -f "${S6_ENV_DIR}/SUPERVISOR_TOKEN" ]; then
    SUPERVISOR_TOKEN=$(cat "${S6_ENV_DIR}/SUPERVISOR_TOKEN")
fi
if [ -z "$SUPERVISOR_TOKEN" ]; then
    echo "[init] WARNING: SUPERVISOR_TOKEN is empty — HA API calls will fail (401)"
    echo "[init] DEBUG: s6 env dir contents: $(ls ${S6_ENV_DIR}/ 2>/dev/null | tr '\n' ' ')"
else
    echo "[init] SUPERVISOR_TOKEN found (${#SUPERVISOR_TOKEN} chars)"
fi
write_env "HA_URL" "http://supervisor/core"
write_env "HA_TOKEN" "$SUPERVISOR_TOKEN"

# --- Shodh Memory (internal, always localhost) ---
write_env "SHODH_URL" "http://127.0.0.1:3030"
write_env "SHODH_API_KEY" "$SHODH_KEY"

# --- API auth ---
#
# Hand the token to the companion integration through a file in /config. The
# add-on has config:rw, so this lands in the directory Home Assistant reads its
# own configuration from, and the integration re-reads it every time it sets up.
# That is what makes it work for installs that already exist.
#
# 2.4.0 tried to do this through the Supervisor discovery message instead, and
# broke Assist for every existing user: Supervisor DEDUPLICATES discovery, so
# re-announcing returns the same uuid, raises no new event, and the config flow
# never re-runs — the entry never learned the token while the server had already
# started rejecting it. A file has no such one-shot semantics.
#
# The token is ALWAYS required, except from Home Assistant Core itself while
# the integration has not yet proved it holds the token (API_AUTH_GRACE). The
# integration writes back the SHA-256 of the token it loaded; until that
# receipt matches, Core may call without it, so Assist keeps working through
# an update or a token rotation. Every other caller (other add-ons on the
# hassio network, a published port) needs the token from the first start:
# before 0.9.3 the whole API was open during that window.
TOKEN_HANDOFF="/config/nives/.api_token"
TOKEN_ACK="${TOKEN_HANDOFF}.ack"

write_env "API_TOKEN" "$API_TOKEN"
if mkdir -p "$(dirname "$TOKEN_HANDOFF")" 2>/dev/null &&
    printf '%s' "$API_TOKEN" > "$TOKEN_HANDOFF" 2>/dev/null; then
    chmod 600 "$TOKEN_HANDOFF" 2>/dev/null || true

    EXPECTED_ACK=$(printf '%s' "$API_TOKEN" | openssl dgst -sha256 -r 2>/dev/null | cut -d' ' -f1)
    ACTUAL_ACK=$(tr -d '[:space:]' < "$TOKEN_ACK" 2>/dev/null || echo "")

    if [ -n "$EXPECTED_ACK" ] && [ "$ACTUAL_ACK" = "$EXPECTED_ACK" ]; then
        echo "[init] API authentication enabled"
    else
        write_env "API_AUTH_GRACE" "true"
        echo "[init] API authentication enabled; Home Assistant Core may call without"
        echo "[init]          the token until the MaDo integration confirms it has it"
        echo "[init]          (normal right after an update; it ends at the next start)."
    fi
else
    write_env "API_AUTH_GRACE" "true"
    echo "[init] WARNING: could not write ${TOKEN_HANDOFF}. API authentication is"
    echo "[init]          enabled; only Home Assistant Core may call without the token."
fi

# --- Mistral platform key ---
# Web search, the agent tools (code, images, documents, connectors), PDF OCR,
# Voxtral speech. The dedicated key is preferred; a Mistral chat key works as
# well, since both are keys to the same account.
if [ -z "$MISTRAL_API_KEY" ] && [ "$LLM_PROVIDER" = "mistral" ]; then
    MISTRAL_API_KEY="$LLM_API_KEY"
fi

# --- Speech-to-text (the chat panel's microphone) ---
STT_KEY="$MISTRAL_API_KEY"
if [ "$SPEECH_TO_TEXT" != "off" ] && [ -n "$STT_KEY" ]; then
    write_env "STT_PROVIDER" "mistral"
    write_env "STT_API_KEY" "$STT_KEY"
    echo "[init] Speech-to-text: Mistral Voxtral"
else
    echo "[init] Speech-to-text: off (${SPEECH_TO_TEXT}; needs a Mistral key)"
fi

# --- Text-to-speech (Voxtral) ---
if [ "$TEXT_TO_SPEECH" = "mistral" ] && [ -n "$MISTRAL_API_KEY" ]; then
    write_env "TTS_PROVIDER" "mistral"
    [ -n "$TTS_VOICE" ] && write_env "TTS_VOICE" "$TTS_VOICE"
    echo "[init] Text-to-speech: Mistral Voxtral"
else
    echo "[init] Text-to-speech: off (${TEXT_TO_SPEECH}; needs a Mistral key)"
fi

# --- Server configuration (always the same in add-on mode) ---
write_env "PORT" "3100"
write_env "CONVERSATION_STORAGE" "sqlite"
write_env "CONVERSATION_DB_PATH" "/data/conversations.db"
write_env "MEMORY_CLEANUP_INTERVAL_HOURS" "6"
write_env "LOG_LEVEL" "$LOG_LEVEL"

# --- Optional ---
[ -n "$CUSTOM_PROMPT" ] && write_env "CUSTOM_PROMPT" "$CUSTOM_PROMPT"
[ -n "$CUSTOM_PROMPT_VOICE" ] && write_env "CUSTOM_PROMPT_VOICE" "$CUSTOM_PROMPT_VOICE"
[ -n "$CUSTOM_PROMPT_THREAD" ] && write_env "CUSTOM_PROMPT_THREAD" "$CUSTOM_PROMPT_THREAD"
[ -n "$ASSIST_MODE" ] && write_env "ASSIST_MODE" "$ASSIST_MODE"
[ -n "$THREAD_MEMORY" ] && write_env "THREAD_MEMORY" "$THREAD_MEMORY"
write_env "MISTRAL_API_KEY" "$MISTRAL_API_KEY"
[ -n "$MAX_OUTPUT_TOKENS" ] && write_env "MAX_OUTPUT_TOKENS" "$MAX_OUTPUT_TOKENS"
[ -n "$REASONING_EFFORT" ] && write_env "REASONING_EFFORT" "$REASONING_EFFORT"
[ -n "$THREAD_REASONING" ] && write_env "THREAD_REASONING" "$THREAD_REASONING"
[ -n "$MISTRAL_LIBRARY_IDS" ] && write_env "MISTRAL_LIBRARY_IDS" "$MISTRAL_LIBRARY_IDS"
[ -n "$MISTRAL_CONNECTORS" ] && write_env "MISTRAL_CONNECTORS" "$MISTRAL_CONNECTORS"
[ -n "$OCR_PRICE" ] && write_env "OCR_PRICE_PER_1000_PAGES" "$OCR_PRICE"
[ -n "$FAST_MODEL" ] && write_env "FAST_MODEL" "$FAST_MODEL"
[ -n "$NOTIFY_SERVICE" ] && write_env "NOTIFY_SERVICE" "$NOTIFY_SERVICE"
[ -n "$DAILY_BRIEFING_TIME" ] && write_env "DAILY_BRIEFING_TIME" "$DAILY_BRIEFING_TIME"
[ -n "$DAILY_BRIEFING_PROMPT" ] && write_env "DAILY_BRIEFING_PROMPT" "$DAILY_BRIEFING_PROMPT"
[ -n "$MODEL_PRICES" ] && write_env "MODEL_PRICES" "$MODEL_PRICES"
[ -n "$HOUSE_WATCH" ] && write_env "HOUSE_WATCH" "$HOUSE_WATCH"
[ -n "$CONFIG_EDITS" ] && write_env "CONFIG_EDITS" "$CONFIG_EDITS"
[ -n "$WATCH_QUIET_HOURS" ] && write_env "WATCH_QUIET_HOURS" "$WATCH_QUIET_HOURS"
[ -n "$WATCH_MAX_PER_DAY" ] && write_env "WATCH_MAX_PER_DAY" "$WATCH_MAX_PER_DAY"
[ -n "$WATCH_LIVELY_TIME" ] && write_env "WATCH_LIVELY_TIME" "$WATCH_LIVELY_TIME"
[ -n "$EXTRACTION_MODEL" ] && write_env "EXTRACTION_MODEL" "$EXTRACTION_MODEL"
[ -n "$EXTRACTION_GATE" ] && write_env "EXTRACTION_GATE" "$EXTRACTION_GATE"
[ -n "$LAYOUT_FROM_EXPOSED" ] && write_env "LAYOUT_FROM_EXPOSED" "$LAYOUT_FROM_EXPOSED"
[ -n "$TOOLS_FROM_EXPOSED" ] && write_env "TOOLS_FROM_EXPOSED" "$TOOLS_FROM_EXPOSED"
[ -n "$LAYOUT_DOMAINS" ] && write_env "LAYOUT_DOMAINS" "$LAYOUT_DOMAINS"
[ -n "$MEMORY_TOKEN_LIMIT" ] && write_env "MEMORY_TOKEN_LIMIT" "$MEMORY_TOKEN_LIMIT"

echo "[init] Environment configured (mode=${LLM_MODE}, provider=${LLM_PROVIDER:-cloud}, max_output_tokens=${MAX_OUTPUT_TOKENS:-default}, reasoning_effort=${REASONING_EFFORT:-default})"
