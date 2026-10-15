import { CONFIG_TOOLS, HOME_EXTRA_TOOLS, TOOL_DEFINITIONS, toAnthropicTools } from "./tool-definitions.js";

export const HA_TOOLS = toAnthropicTools([...TOOL_DEFINITIONS, ...HOME_EXTRA_TOOLS, ...CONFIG_TOOLS]);
