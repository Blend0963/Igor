"""Config flow for Igor integration."""

from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.hassio import HassioServiceInfo

from .const import (
    DOMAIN,
    CONF_API_URL,
    CONF_API_TOKEN,
    CONF_SHARED_MEMORY,
    CONF_USER_ID,
    CONF_VOICE_DISPLAY,
    CONF_KEY_ENTITY,
    CONF_ALARM_ENTITY,
    CONF_ALARM_ACTIVE,
    CONF_NEW_CODE,
    CONF_CODE_HASH,
    CONF_TRAFFIC_KEY,
    CONF_ALLOWED_USERS,
    DEFAULT_API_URL,
    DEFAULT_SHARED_MEMORY,
    DEFAULT_USER_ID,
    DEFAULT_VOICE_DISPLAY,
    API_HEALTH_ENDPOINT,
)

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_API_URL, default=DEFAULT_API_URL): str,
        vol.Optional(CONF_API_TOKEN): str,
        vol.Optional(CONF_USER_ID, default=DEFAULT_USER_ID): str,
    }
)


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the user input allows us to connect."""
    session = async_get_clientsession(hass)
    api_url = data[CONF_API_URL].rstrip("/")
    api_token = data.get(CONF_API_TOKEN, "").strip() or None

    headers = {}
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"

    try:
        # First check that the server is reachable via unauthenticated health endpoint
        async with session.get(
            f"{api_url}{API_HEALTH_ENDPOINT}",
            timeout=aiohttp.ClientTimeout(total=10),
        ) as response:
            if response.status != 200:
                raise CannotConnect(f"API returned status {response.status}")
            result = await response.json()
            if result.get("status") != "ok":
                raise CannotConnect("API health check failed")

        # If a token was provided, verify it against a protected endpoint
        if api_token:
            user_id = data.get(CONF_USER_ID, DEFAULT_USER_ID)
            async with session.get(
                f"{api_url}/api/memory/{user_id}",
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                if response.status in (401, 403):
                    raise InvalidAuth("Invalid API token")
                if response.status != 200:
                    raise CannotConnect(
                        f"Token verification returned status {response.status}"
                    )
    except aiohttp.ClientError as err:
        _LOGGER.error("Error connecting to Igor API: %s", err)
        raise CannotConnect from err

    return {"title": "Igor"}


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Igor."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._hassio_discovery: dict[str, Any] | None = None

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> OptionsFlow:
        """Get the options flow for this handler."""
        return OptionsFlow()

    async def async_step_hassio(
        self, discovery_info: HassioServiceInfo
    ) -> ConfigFlowResult:
        """Handle discovery from the Igor add-on."""
        config = discovery_info.config
        host = config.get("host", "")
        port = config.get("port", 3100)
        api_token = (config.get("api_token") or "").strip()
        api_url = f"http://{host}:{port}"

        self._hassio_discovery = {"host": host, "port": port, "api_token": api_token}

        await self.async_set_unique_id(f"nives_addon_{host}")

        # Note: this only ever runs for a NEW entry. Supervisor deduplicates
        # discovery messages, so an add-on that re-announces itself raises no
        # new event and this flow is not re-entered — updates= below will not
        # reach an install that already exists. Assuming otherwise is what broke
        # Assist in 2.4.0. The token an existing entry actually uses comes from
        # the file the add-on writes (see const.TOKEN_FILE_RELPATH), which is
        # re-read on every setup.
        updates: dict[str, Any] = {CONF_API_URL: api_url}
        if api_token:
            updates[CONF_API_TOKEN] = api_token
        self._abort_if_unique_id_configured(updates=updates)

        return await self.async_step_hassio_confirm()

    async def async_step_hassio_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm Igor add-on discovery."""
        if user_input is not None:
            assert self._hassio_discovery is not None
            host = self._hassio_discovery["host"]
            port = self._hassio_discovery["port"]
            api_token = self._hassio_discovery.get("api_token", "")
            data: dict[str, Any] = {
                CONF_API_URL: f"http://{host}:{port}",
                CONF_USER_ID: DEFAULT_USER_ID,
            }
            if api_token:
                data[CONF_API_TOKEN] = api_token
            return self.async_create_entry(title="Igor", data=data)

        return self.async_show_form(step_id="hassio_confirm")

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                info = await validate_input(self.hass, user_input)
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception("Unexpected exception")
                errors["base"] = "unknown"
            else:
                return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )


class OptionsFlow(config_entries.OptionsFlow):
    """Memory and wall-tablet settings, changeable after setup.

    Add-on installs are created by discovery and never see the manual form, so
    until this existed their user_id could only be changed by deleting and
    re-adding the integration (nives#65). Saving reloads the entry through the
    update listener in __init__.py.
    """

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        current = {**self.config_entry.data, **self.config_entry.options}
        errors: dict[str, str] = {}
        if user_input is not None:
            user_input[CONF_USER_ID] = (
                user_input.get(CONF_USER_ID, "").strip() or DEFAULT_USER_ID
            )
            # The disarm code is never kept: only its salted hash. Left empty,
            # the code already set stays.
            code = str(user_input.pop(CONF_NEW_CODE, "") or "").strip()
            if code and (len(code) < 4 or not code.isdigit()):
                errors[CONF_NEW_CODE] = "bad_code"
            else:
                from .security import hash_code

                if code:
                    user_input[CONF_CODE_HASH] = await self.hass.async_add_executor_job(hash_code, code)
                elif current.get(CONF_CODE_HASH):
                    user_input[CONF_CODE_HASH] = current[CONF_CODE_HASH]
                # The traffic key: never shown back. Left empty, the key
                # already set stays; a dash removes it.
                key = str(user_input.pop(CONF_TRAFFIC_KEY, "") or "").strip()
                if key == "-":
                    key = ""
                elif not key:
                    key = str(current.get(CONF_TRAFFIC_KEY) or "")
                if key:
                    user_input[CONF_TRAFFIC_KEY] = key
                return self.async_create_entry(title="", data=user_input)

        # Home Assistant's people, to pick who Igor still answers while the
        # key is away (no name to type wrong); names set in YAML stay listed.
        users = [u for u in await self.hass.auth.async_get_users() if not u.system_generated and u.is_active]
        allowed_now = [str(a) for a in current.get(CONF_ALLOWED_USERS) or []]
        choices = [selector.SelectOptionDict(value=u.id, label=u.name or u.id) for u in users]
        known = {u.id for u in users}
        choices += [selector.SelectOptionDict(value=a, label=a) for a in allowed_now if a not in known]
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SHARED_MEMORY,
                        default=current.get(CONF_SHARED_MEMORY, DEFAULT_SHARED_MEMORY),
                    ): bool,
                    vol.Required(
                        CONF_USER_ID,
                        default=current.get(CONF_USER_ID) or DEFAULT_USER_ID,
                    ): str,
                    vol.Required(
                        CONF_VOICE_DISPLAY,
                        default=current.get(CONF_VOICE_DISPLAY, DEFAULT_VOICE_DISPLAY),
                    ): bool,
                    vol.Optional(
                        CONF_KEY_ENTITY,
                        description={"suggested_value": current.get(CONF_KEY_ENTITY)},
                    ): selector.EntitySelector(selector.EntitySelectorConfig(domain="binary_sensor")),
                    vol.Optional(
                        CONF_ALARM_ENTITY,
                        description={"suggested_value": current.get(CONF_ALARM_ENTITY)},
                    ): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain=["input_boolean", "switch", "alarm_control_panel"])
                    ),
                    vol.Optional(
                        CONF_ALARM_ACTIVE,
                        description={"suggested_value": current.get(CONF_ALARM_ACTIVE)},
                    ): selector.EntitySelector(selector.EntitySelectorConfig(domain="binary_sensor")),
                    vol.Optional(CONF_NEW_CODE, default=""): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                    vol.Optional(
                        CONF_ALLOWED_USERS,
                        description={"suggested_value": allowed_now},
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(options=choices, multiple=True, custom_value=True)
                    ),
                    vol.Optional(CONF_TRAFFIC_KEY, default=""): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )


class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""


class InvalidAuth(HomeAssistantError):
    """Error to indicate invalid authentication."""
