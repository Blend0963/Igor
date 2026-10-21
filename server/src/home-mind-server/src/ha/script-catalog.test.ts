import { describe, it, expect } from "vitest";
import { formatScriptSection } from "./script-catalog.js";

describe("formatScriptSection", () => {
  it("is empty without scripts", () => {
    expect(formatScriptSection([])).toBeUndefined();
  });

  it("names each script, its fields and how to run it", () => {
    const text = formatScriptSection([
      {
        id: "script.minuteur",
        name: "Minuteur",
        description: "Lance un minuteur",
        fields: [{ name: "recipient", description: "Durée en secondes", required: true, example: 300 }],
        returns: false,
      },
      { id: "script.contacts", name: "Contacts", fields: [], returns: true },
    ])!;
    expect(text).toContain("## Scripts you can run");
    expect(text).toContain('service = the part after "script."');
    expect(text).toContain("- script.minuteur — Minuteur: Lance un minuteur. Fields: recipient (required) — Durée en secondes — e.g. 300");
    expect(text).toContain("- script.contacts — Contacts. No fields. Returns a result");
  });
});
