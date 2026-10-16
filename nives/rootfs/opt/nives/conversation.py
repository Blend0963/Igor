"""Conversation agent for MaDo."""

from __future__ import annotations

import logging
from typing import Literal

import aiohttp

from homeassistant.components.conversation import (
    ConversationEntity,
    ConversationEntityFeature,
    ConversationInput,
    ConversationResult,
)

# Streamed replies need the chat log (Home Assistant 2025.3+). On an older
# Core the whole reply still arrives in one piece through the legacy path.
try:
    from homeassistant.components.conversation import ChatLog

    STREAMING_SUPPORTED = hasattr(ChatLog, "async_add_delta_content_stream")
except ImportError:  # pragma: no cover - older cores
    ChatLog = None  # type: ignore[assignment,misc]
    STREAMING_SUPPORTED = False
from homeassistant.const import MATCH_ALL
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er, intent
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

try:
    from homeassistant.util.ulid import ulid_now
except ImportError:  # very old cores
    from uuid import uuid4

    def ulid_now() -> str:
        """Fallback id for cores without the ulid helper."""
        return uuid4().hex

from . import MaDoConfigEntry
from .const import (
    API_CHAT_ENDPOINT,
    API_CHAT_STREAM_ENDPOINT,
    DEFAULT_TIMEOUT,
)
from .stream import DeltaBuilder, SseParser

_LOGGER = logging.getLogger(__name__)


def _out_of_credit_speech(language: str | None) -> str:
    """What MaDo says when the AI provider has no credit left."""
    if (language or "").lower().startswith("fr"):
        return "Mon fournisseur d'IA n'a plus de crédit. Recharge le compte et je reprends tout de suite."
    return "My AI provider has run out of credit. Add credit to its account and I'll pick right back up."


class UsageLimitError(Exception):
    """Raised when the MaDo server returns HTTP 402 (usage limit reached)."""


class StreamUnavailable(Exception):
    """The server has no streaming endpoint; use the single-request path."""


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: MaDoConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up conversation agent from a config entry."""
    async_add_entities([MaDoConversationAgent(hass, config_entry)])


class MaDoConversationAgent(ConversationEntity):
    """MaDo conversation agent."""

    _attr_has_entity_name = True
    _attr_name = None  # entity name = device name
    _attr_supported_features = ConversationEntityFeature.CONTROL
    _attr_translation_key = "nives"

    def __init__(self, hass: HomeAssistant, entry: MaDoConfigEntry) -> None:
        """Initialize the agent."""
        self.hass = hass
        self.entry = entry
        self._session = async_get_clientsession(hass)

        self._attr_unique_id = entry.entry_id
        self._attr_device_info = dr.DeviceInfo(
            identifiers={(entry.domain, entry.entry_id)},
            name="MaDo",
            manufacturer="MaDo",
            model="AI Assistant",
            entry_type=dr.DeviceEntryType.SERVICE,
        )

    @property
    def supported_languages(self) -> list[str] | Literal["*"]:
        """Return supported languages."""
        return MATCH_ALL

    def _memory_user_id(self, user_input: ConversationInput) -> str:
        """Whose memory this request reads and writes.

        With shared memory on (the default) it is always the configured one.
        Otherwise a request made by a Home Assistant user gets that user's own
        memory, and one with no user behind it (a voice satellite, an
        automation) falls back to the configured one. That fallback is what
        silently split a household in two before 2.7.0 (nives#65): the puck
        and the dashboard each kept a memory the other could not see.
        """
        data = self.entry.runtime_data
        if not data.shared_memory and user_input.context and user_input.context.user_id:
            return str(user_input.context.user_id)
        return data.user_id

    async def async_process(self, user_input: ConversationInput) -> ConversationResult:
        """Answer, streaming into the chat log where the Core supports it."""
        if not STREAMING_SUPPORTED:
            return await self._async_process_legacy(user_input)
        # The base class opens the chat session and log and calls
        # _async_handle_message with them.
        return await super().async_process(user_input)

    def _satellite(self, user_input: ConversationInput) -> str | None:
        """The voice satellite a request comes from, if any.

        Home Assistant sets satellite_id for the satellite's own runs. A run
        started elsewhere in a satellite's name (mado-ear, which hears "MaDo"
        without the wake word and sends the audio through the Assist pipeline
        with the satellite's device_id) carries only the device: it is the
        satellite's when that device has an assist_satellite entity. A phone
        passes its own device_id too, but has no such entity.
        """
        satellite = getattr(user_input, "satellite_id", None)
        if satellite:
            return satellite
        device_id = getattr(user_input, "device_id", None)
        if not device_id:
            return None
        for entry in er.async_entries_for_device(er.async_get(self.hass), device_id):
            if entry.domain == "assist_satellite":
                return entry.entity_id
        return None

    def _voice_sensor(self, user_input: ConversationInput):
        """The wall-tablet sensor when this is a voice satellite's request."""
        satellite = self._satellite(user_input)
        sensor = getattr(self.entry.runtime_data, "voice_sensor", None)
        if satellite is None or sensor is None or sensor.hass is None:
            return None
        sensor.begin(user_input.text, satellite)
        return sensor

    @staticmethod
    def _voice_finish(sensor, result: ConversationResult) -> ConversationResult:
        """Close the tablet's turn with what is spoken, unless the stream did."""
        if sensor is not None and sensor.active:
            speech = result.response.speech.get("plain", {}).get("speech", "")
            error = result.response.response_type == intent.IntentResponseType.ERROR
            sensor.finish(speech, error=error)
        return result

    async def _async_handle_message(
        self,
        user_input: ConversationInput,
        chat_log: ChatLog,
    ) -> ConversationResult:
        """Follow the turn on the wall-tablet sensor around the streamed reply."""
        sensor = self._voice_sensor(user_input)
        try:
            result = await self._async_stream_message(user_input, chat_log, sensor)
        except BaseException:
            if sensor is not None and sensor.active:
                sensor.finish(None, error=True)
            raise
        return self._voice_finish(sensor, result)

    async def _async_stream_message(
        self,
        user_input: ConversationInput,
        chat_log: ChatLog,
        sensor=None,
    ) -> ConversationResult:
        """Stream the reply into the chat log as the server produces it.

        Until now the integration made one request and showed nothing until
        the complete answer came back, which for a question over a week of
        history meant a blank dialog for forty seconds and no way to tell
        "thinking" from "crashed". The server now streams: the model's own
        heads-up before a long lookup, or the server's, appears within a few
        seconds as its own message, and the answer is written out as it is
        produced. Home Assistant reads the LAST assistant message aloud, so
        the heads-up is seen but not spoken.
        """
        _LOGGER.debug("Processing conversation input: %s", user_input.text)

        data = self.entry.runtime_data
        user_id = self._memory_user_id(user_input)
        conversation_id = chat_log.conversation_id
        is_voice = self._satellite(user_input) is not None

        try:
            async for _content in chat_log.async_add_delta_content_stream(
                self.entity_id,
                self._stream_deltas(
                    api_url=data.api_url,
                    api_token=data.api_token,
                    message=user_input.text,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    language=user_input.language,
                    is_voice=is_voice,
                    sensor=sensor,
                ),
            ):
                pass
        except UsageLimitError:
            return await self._usage_limit_result(user_input, conversation_id)
        except aiohttp.ClientResponseError as err:
            _LOGGER.error("MaDo server returned an error: %s", err.message)
            return self._error_result(
                user_input,
                conversation_id,
                f"Sorry, the MaDo server returned an error (HTTP {err.status}). "
                "The add-on log has the details.",
            )
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("Error calling MaDo API: %s", err)
            return self._error_result(
                user_input,
                conversation_id,
                "Sorry, I couldn't reach the MaDo server right now.",
            )

        return self._result_from_chat_log(user_input, chat_log)

    async def _stream_deltas(
        self,
        api_url: str,
        api_token: str | None,
        message: str,
        user_id: str,
        conversation_id: str,
        language: str | None,
        is_voice: bool,
        sensor=None,
    ):
        """Yield chat-log deltas from the server's event stream.

        A server without the streaming endpoint (an older add-on paired with
        a newer integration) answers 404 before anything is streamed, so the
        single-request path can still be used and its reply yielded whole.
        """
        builder = DeltaBuilder()
        try:
            async for event, payload in self._stream_events(
                api_url, api_token, message, user_id, conversation_id, language, is_voice
            ):
                for delta in builder.handle(event, payload):
                    yield delta
                if sensor is not None:
                    self._follow(sensor, builder, event, payload)
                if builder.error:
                    if builder.error == "usage_limit_reached":
                        raise UsageLimitError()
                    raise aiohttp.ClientError(builder.error)
        except StreamUnavailable:
            text = await self._call_api(
                api_url=api_url,
                api_token=api_token,
                message=message,
                user_id=user_id,
                conversation_id=conversation_id,
                language=language,
                is_voice=is_voice,
            )
            yield {"role": "assistant"}
            yield {"content": text}
            return

        if builder.final is None and not builder.wrote_anything:
            # The stream ended without a `done` event and without text: the
            # connection dropped mid-reply. Say so rather than show nothing.
            yield {"role": "assistant"}
            yield {"content": "Sorry, I lost the connection to the MaDo server mid-reply."}

    @staticmethod
    def _follow(sensor, builder: DeltaBuilder, event: str, payload: dict) -> None:
        """Mirror one server event on the wall-tablet sensor."""
        if event == "status":
            sensor.status(str(payload.get("text") or ""))
        elif event == "chunk":
            sensor.answer(builder.current_text)
        elif event == "done":
            sensor.finish(builder.current_text, payload.get("actions"))

    async def _stream_events(
        self,
        api_url: str,
        api_token: str | None,
        message: str,
        user_id: str,
        conversation_id: str,
        language: str | None,
        is_voice: bool,
    ):
        """POST to the streaming endpoint and yield (event, data) pairs."""
        url = f"{api_url}{API_CHAT_STREAM_ENDPOINT}"
        payload: dict = {
            "message": message,
            "userId": user_id,
            "isVoice": is_voice,
            "conversationId": conversation_id,
        }
        if language:
            payload["language"] = language
        headers: dict = {"Accept": "text/event-stream"}
        if api_token:
            headers["Authorization"] = f"Bearer {api_token}"

        async with self._session.post(
            url,
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
        ) as response:
            if response.status == 404:
                raise StreamUnavailable()
            if response.status == 402:
                raise UsageLimitError()
            if response.status != 200:
                body = (await response.text())[:300]
                raise aiohttp.ClientResponseError(
                    response.request_info,
                    response.history,
                    status=response.status,
                    message=f"API error {response.status}: {body}",
                )
            parser = SseParser()
            async for raw in response.content:
                for event in parser.feed(raw.decode("utf-8", errors="replace")):
                    yield event
            for event in parser.feed(""):
                yield event

    def _result_from_chat_log(
        self, user_input: ConversationInput, chat_log: ChatLog
    ) -> ConversationResult:
        """Build the result the way Home Assistant's own agents do."""
        intent_response = intent.IntentResponse(language=user_input.language)
        last = chat_log.content[-1] if chat_log.content else None
        text = getattr(last, "content", None) if getattr(last, "role", None) == "assistant" else None
        intent_response.async_set_speech(text or "")
        # Home Assistant reopens the satellite mic when the reply ends with a
        # question mark; its own rule, computed from the same last message.
        continue_conversation = bool(getattr(chat_log, "continue_conversation", False))
        try:
            return ConversationResult(
                response=intent_response,
                conversation_id=chat_log.conversation_id,
                continue_conversation=continue_conversation,
            )
        except TypeError:
            return ConversationResult(
                response=intent_response,
                conversation_id=chat_log.conversation_id,
            )

    async def _usage_limit_result(
        self, user_input: ConversationInput, conversation_id: str | None
    ) -> ConversationResult:
        """Tell the user the balance is gone, once in the dialog and once as a notification."""
        _LOGGER.warning("MaDo usage limit reached")
        await self.hass.services.async_call(
            "persistent_notification",
            "create",
            {
                "title": "MaDo — AI provider out of credit",
                "message": (
                    "Your AI provider reports that its credit is used up. "
                    "Add credit to that account (Mistral, OpenAI, "
                    "Anthropic…) and MaDo picks right back up."
                ),
                "notification_id": "nives_usage_limit",
            },
        )
        intent_response = intent.IntentResponse(language=user_input.language)
        intent_response.async_set_speech(
            _out_of_credit_speech(user_input.language)
        )
        return ConversationResult(response=intent_response, conversation_id=conversation_id)

    def _error_result(
        self, user_input: ConversationInput, conversation_id: str | None, text: str
    ) -> ConversationResult:
        """An error reply in the shape Home Assistant expects."""
        intent_response = intent.IntentResponse(language=user_input.language)
        intent_response.async_set_error(intent.IntentResponseErrorCode.UNKNOWN, text)
        return ConversationResult(response=intent_response, conversation_id=conversation_id)

    async def _async_process_legacy(self, user_input: ConversationInput) -> ConversationResult:
        """One request, one complete reply: for Cores without a chat log."""
        sensor = self._voice_sensor(user_input)
        try:
            result = await self._async_process_legacy_inner(user_input)
        except BaseException:
            if sensor is not None and sensor.active:
                sensor.finish(None, error=True)
            raise
        return self._voice_finish(sensor, result)

    async def _async_process_legacy_inner(self, user_input: ConversationInput) -> ConversationResult:
        """The single request behind _async_process_legacy."""
        _LOGGER.debug("Processing conversation input: %s", user_input.text)

        data = self.entry.runtime_data
        user_id = self._memory_user_id(user_input)

        # Mint an id when the caller has none. Home Assistant's own Assist
        # pipeline always supplies one, so this only ever bit the callers that
        # do not: the REST API, a script, an automation, a desktop client.
        # Echoing None straight back left them nothing to send on the next
        # turn, so every message began a brand new conversation — follow-ups
        # lost their subject, and the two-step automation confirmation could
        # never be completed, because the second turn had forgotten the first.
        conversation_id = user_input.conversation_id or ulid_now()

        # "Spoken" means the request came from a voice satellite entity (Voice
        # PE, ESPHome and Wyoming satellites), which is the only case where the
        # reply is certain to be read aloud and nothing else. HA sets
        # satellite_id on exactly those requests. The server uses this to switch
        # to its voice persona: shorter prompt, tighter token budget.
        #
        # This used to key on device_id, on the belief that the app's Assist
        # dialog sends none. It does: the companion app passes the phone's own
        # device_id on every run, typed or spoken, so every question typed on a
        # phone was answered under the 500-token spoken ceiling. Long analytical
        # questions could not be answered from a phone at all, and the failure
        # looked like a model problem. Found from the add-on's own cap log
        # (`cap=500`) once that existed. The phone's mic button now counts as
        # written, so a long spoken answer is read out in full rather than cut
        # off, which is how Home Assistant's own conversation integrations
        # behave. (getattr: satellite_id does not exist on older Cores.)
        is_voice = self._satellite(user_input) is not None

        try:
            response_text = await self._call_api(
                api_url=data.api_url,
                api_token=data.api_token,
                message=user_input.text,
                user_id=user_id,
                conversation_id=conversation_id,
                language=user_input.language,
                is_voice=is_voice,
            )
        except UsageLimitError:
            _LOGGER.warning("MaDo usage limit reached")
            await self.hass.services.async_call(
                "persistent_notification",
                "create",
                {
                    "title": "MaDo — AI provider out of credit",
                    "message": (
                        "Your AI provider reports that its credit is used up. "
                        "Add credit to that account (Mistral, OpenAI, "
                        "Anthropic…) and MaDo picks right back up."
                    ),
                    "notification_id": "nives_usage_limit",
                },
            )
            intent_response = intent.IntentResponse(language=user_input.language)
            intent_response.async_set_speech(
                _out_of_credit_speech(user_input.language)
            )
            return ConversationResult(
                response=intent_response,
                conversation_id=conversation_id,
            )
        except aiohttp.ClientResponseError as err:
            # The server ANSWERED — with an error status. Saying "couldn't
            # reach the server" here sends people debugging connectivity when
            # the log already names the real problem (#63, and #1 before it).
            _LOGGER.error("MaDo server returned an error: %s", err.message)
            intent_response = intent.IntentResponse(language=user_input.language)
            intent_response.async_set_error(
                intent.IntentResponseErrorCode.UNKNOWN,
                f"Sorry, the MaDo server returned an error (HTTP {err.status}). "
                "The add-on log has the details.",
            )
            return ConversationResult(
                response=intent_response,
                conversation_id=conversation_id,
            )
        except (aiohttp.ClientError, TimeoutError) as err:
            _LOGGER.error("Error calling MaDo API: %s", err)
            intent_response = intent.IntentResponse(language=user_input.language)
            intent_response.async_set_error(
                intent.IntentResponseErrorCode.UNKNOWN,
                "Sorry, I couldn't reach the MaDo server right now.",
            )
            return ConversationResult(
                response=intent_response,
                conversation_id=conversation_id,
            )

        intent_response = intent.IntentResponse(language=user_input.language)
        intent_response.async_set_speech(response_text)

        # Reopen the satellite mic for a follow-up when we just asked a question,
        # mirroring Home Assistant's built-in agents (continue_conversation is True
        # when the response ends with a question mark — "?" or full-width "？").
        # Guarded: older HA versions' ConversationResult has no such field.
        continue_conversation = bool(response_text) and response_text.rstrip().endswith(
            ("?", "？")
        )
        if continue_conversation:
            try:
                return ConversationResult(
                    response=intent_response,
                    conversation_id=conversation_id,
                    continue_conversation=True,
                )
            except TypeError:
                _LOGGER.debug(
                    "ConversationResult has no continue_conversation field on this HA version"
                )

        return ConversationResult(
            response=intent_response,
            conversation_id=conversation_id,
        )

    async def _call_api(
        self,
        api_url: str,
        api_token: str | None,
        message: str,
        user_id: str,
        conversation_id: str | None,
        language: str | None = None,
        is_voice: bool = False,
    ) -> str:
        """Call the MaDo API."""
        url = f"{api_url}{API_CHAT_ENDPOINT}"

        payload: dict = {
            "message": message,
            "userId": user_id,
            "isVoice": is_voice,
        }
        # Only send the key when there is a conversation in flight. A service
        # call without a conversation_id would otherwise put an explicit null
        # on the wire, which request validation rejects (#63).
        if conversation_id:
            payload["conversationId"] = conversation_id
        # The Assist pipeline's language (e.g. "sl", "en"). Without it the model
        # has no anchor at all and infers the language from context that is
        # soaked in native-language entity names — which is how an English
        # question got a Slovenian answer. The server uses it only as a
        # tie-breaker; the language of the user's actual words always wins.
        if language:
            payload["language"] = language

        # The persona (Custom Prompt) is deliberately NOT sent per request. It
        # lives in one place only — the add-on's Configuration tab — and the
        # server applies it from there. The integration used to send its own
        # options value here, which silently overrode the add-on field and
        # cost days of confusion on nives#54.

        headers: dict = {}
        if api_token:
            headers["Authorization"] = f"Bearer {api_token}"

        async with self._session.post(
            url,
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
        ) as response:
            if response.status == 402:
                raise UsageLimitError()
            if response.status != 200:
                # Capture the body: the status alone says "the server
                # objected", the body says WHY (validation details, error
                # codes) — and this log line is all a bug report will carry.
                body = (await response.text())[:300]
                raise aiohttp.ClientResponseError(
                    response.request_info,
                    response.history,
                    status=response.status,
                    message=f"API error {response.status}: {body}",
                )
            data = await response.json()
            response_text = data.get("response")
            if response_text:
                return response_text
            error = data.get("error")
            if isinstance(error, dict):
                hint = error.get("hint")
                code = error.get("code")
                if hint:
                    return f"{hint} [{code}]" if code else hint
            return "I received your request but got no response."
