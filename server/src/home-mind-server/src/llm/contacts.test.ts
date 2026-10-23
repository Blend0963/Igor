import { beforeEach, describe, expect, it, vi } from "vitest";
import { contactsFrom, findContact, matchContacts, phoneKey, resetContactsCache } from "./contacts.js";
import type { HomeAssistantClient } from "../ha/client.js";

// What script.contacts_recuperer_tous_les_contacts returns: {contacts: [{nom, mobile, travail}]}.
const RESPONSE = {
  contacts: [
    { nom: "Jean Da Silva Costa", mobile: "06 39 98 00 01", travail: "" },
    { nom: "Jean Martin", mobile: "06 39 98 00 02", travail: "" },
    { nom: "Jean Lambert", mobile: "06 39 98 00 03", travail: "" },
    { nom: "Paul Martin", mobile: "06 39 98 00 04", travail: "" },
    { nom: "Anne-Sophie Lefèvre", mobile: "06 39 98 00 05", travail: "" },
    { nom: "Luc Bernard", mobile: "06 39 98 00 06", travail: "06 39 98 00 07" },
    { nom: "Cabinet Dr. Durand", mobile: "", travail: "01 99 00 00 01" },
  ],
};

describe("contacts", () => {
  const contacts = contactsFrom(RESPONSE);

  it("reads the script's list, with every number it has", () => {
    expect(contacts).toHaveLength(7);
    expect(contacts[5]).toEqual({ name: "Luc Bernard", numbers: { mobile: "06 39 98 00 06", travail: "06 39 98 00 07" } });
    expect(contacts[6].numbers).toEqual({ travail: "01 99 00 00 01" });
    // Rendered as a Python-style dict string instead of a structure.
    expect(contactsFrom(String(JSON.stringify(RESPONSE)).replace(/"/g, "'"))).toHaveLength(7);
  });

  it("finds a full name exactly, in any order, misspelled or without accents", () => {
    for (const q of ["Jean Martin", "martin jean", "Jean Martain", "jean martins"]) {
      expect(matchContacts(contacts, q).map((c) => c.name)[0]).toBe("Jean Martin");
      expect(matchContacts(contacts, q)).toHaveLength(1);
    }
    expect(matchContacts(contacts, "anne sophie lefevre")[0].name).toBe("Anne-Sophie Lefèvre");
  });

  it("returns every contact a first name alone fits, and nothing for a stranger", () => {
    expect(matchContacts(contacts, "Jean").map((c) => c.name).sort()).toEqual(["Jean Da Silva Costa", "Jean Lambert", "Jean Martin"]);
    expect(matchContacts(contacts, "Martin")).toHaveLength(2);
    expect(matchContacts(contacts, "Martine Dupont")).toEqual([]);
  });

  it("tells whose a number is, in national or +33 form", () => {
    expect(phoneKey("+33 6 39 98 00 02")).toBe("0639980002");
    expect(matchContacts(contacts, "+33639980002")[0].name).toBe("Jean Martin");
    expect(matchContacts(contacts, "06-39-98-00-07")[0].name).toBe("Luc Bernard");
  });

  describe("findContact", () => {
    beforeEach(() => {
      resetContactsCache();
      delete process.env.CONTACTS_SCRIPT;
    });

    it("runs the exposed contacts script once and answers with the matches only", async () => {
      const callService = vi.fn().mockResolvedValue({ changed_states: [], service_response: RESPONSE });
      const ha = {
        listScripts: vi.fn().mockResolvedValue([{ id: "script.appeler", returns: false, fields: [] }, { id: "script.contacts_recuperer_tous_les_contacts", returns: true, fields: [] }]),
        callService,
      } as unknown as HomeAssistantClient;

      const found = (await findContact(ha, "Jean Martin")) as { found: number; contacts: unknown[] };
      expect(found.found).toBe(1);
      expect(found.contacts).toEqual([{ name: "Jean Martin", numbers: { mobile: "06 39 98 00 02" } }]);
      expect(callService).toHaveBeenCalledWith("script", "contacts_recuperer_tous_les_contacts", undefined, {});

      await findContact(ha, "Jean");
      expect(callService).toHaveBeenCalledTimes(1);
    });

    it("uses the configured script, and says plainly when nobody matches", async () => {
      process.env.CONTACTS_SCRIPT = "script.mes_contacts";
      const callService = vi.fn().mockResolvedValue({ changed_states: [], service_response: RESPONSE });
      const ha = { listScripts: vi.fn(), callService } as unknown as HomeAssistantClient;
      const none = (await findContact(ha, "Martine Dupont")) as { found: number; note: string };
      expect(callService.mock.calls[0][1]).toBe("mes_contacts");
      expect(none.found).toBe(0);
      expect(none.note).toMatch(/never guess/);
    });
  });
});
