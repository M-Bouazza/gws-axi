import { describe, expect, it } from "vitest";
import { fromHeader } from "./scan.js";
import { extractPhones, normalizeFrPhone } from "../../util/phones.js";
import { messageBodyText } from "../../util/phones.js";
import { mergeValueArray, parseFlags } from "./update.js";
import { parseFlags as parseAddFlags, splitName as splitAddName } from "./add.js";

describe("normalizeFrPhone", () => {
  it("normalizes spaced national numbers", () => {
    expect(normalizeFrPhone("06 12 34 56 78")).toBe("0612345678");
    expect(normalizeFrPhone("06.12.34.56.78")).toBe("0612345678");
    expect(normalizeFrPhone("06-12-34-56-78")).toBe("0612345678");
  });

  it("converts +33 prefixes to national form", () => {
    expect(normalizeFrPhone("+33 6 12 34 56 78")).toBe("0612345678");
    expect(normalizeFrPhone("+33612345678")).toBe("0612345678");
    expect(normalizeFrPhone("0033 6 12 34 56 78")).toBe("0612345678");
  });
});

describe("extractPhones", () => {
  it("extracts spaced and +33 variants, deduped", () => {
    const found = extractPhones(
      "Appelez-moi au 06 12 34 56 78 ou +33 6 12 34 56 78, fixe 01 23 45 67 89.",
    );
    expect(found.map((f) => f.normalized)).toEqual(["0612345678", "0123456789"]);
  });

  it("ignores dates, amounts and SIRET fragments", () => {
    const found = extractPhones(
      "Facture 1 234,56 EUR du 06 12 2026. SIRET 012 345 678 00012. Réf AB-12-34-56-78-90.",
    );
    // 06 12 2026 is a date-like pair pattern but the third group "2026" has 4 digits → no match
    expect(found).toEqual([]);
  });

  it("rejects numbers with adjacent digits (invoice/ref numbers)", () => {
    expect(extractPhones("Réf 00612345678X")).toEqual([]);
    expect(extractPhones("Total 3,0612345678.")).toEqual([]);
  });
});

describe("messageBodyText", () => {
  const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

  it("joins plain-text parts and strips HTML as fallback", () => {
    const text = messageBodyText({
      mimeType: "multipart/mixed",
      body: {},
      parts: [
        {
          mimeType: "text/html",
          body: { data: b64("<html><p>Call me at <b>06 12 34 56 78</b></p></html>") },
        },
        { mimeType: "text/plain", body: { data: b64("Or the office: 01 98 76 54 32") } },
      ],
    });
    expect(text).toContain("01 98 76 54 32");
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("<p>");
  });
});

describe("fromHeader", () => {
  it("parses display name + email", () => {
    expect(fromHeader('"David Dworsky" <david@djuce.com>')).toEqual({
      name: "David Dworsky",
      email: "david@djuce.com",
    });
    expect(fromHeader("David Dworsky <david@djuce.com>")).toEqual({
      name: "David Dworsky",
      email: "david@djuce.com",
    });
  });

  it("handles a bare email", () => {
    expect(fromHeader("david@djuce.com")).toEqual({ name: "", email: "david@djuce.com" });
  });
});

describe("contacts update — parseFlags", () => {
  it("parses the positional contactId with fields", () => {
    expect(parseFlags(["people/c123", "--phone", "06 12 34 56 78"])).toEqual({
      contactId: "people/c123",
      name: undefined,
      email: undefined,
      phone: "06 12 34 56 78",
    });
  });

  it("rejects a missing contactId", () => {
    expect(() => parseFlags(["--phone", "06 12 34 56 78"])).toThrow(/Missing contactId/);
  });

  it("rejects an invocation with no fields", () => {
    expect(() => parseFlags(["people/c123"])).toThrow(/Nothing to update/);
  });
});

describe("mergeValueArray", () => {
  it("replaces the first entry when one exists", () => {
    expect(mergeValueArray([{ value: "old@mail.com" }, { value: "second@mail.com" }], "new@mail.com")).toEqual([
      { value: "new@mail.com" },
      { value: "second@mail.com" },
    ]);
  });

  it("prepends when the array is empty or missing", () => {
    expect(mergeValueArray(undefined, "new@mail.com")).toEqual([{ value: "new@mail.com" }]);
    expect(mergeValueArray([], "new@mail.com")).toEqual([{ value: "new@mail.com" }]);
  });
});

describe("splitName", () => {
  it("splits on the last space", () => {
    expect(splitAddName("David van Dyk")).toEqual({ givenName: "David van", familyName: "Dyk" });
    expect(splitAddName("David")).toEqual({ givenName: "David", familyName: "" });
    expect(splitAddName("Mehdi Bouazza")).toEqual({ givenName: "Mehdi", familyName: "Bouazza" });
  });
});

describe("contacts add — parseFlags", () => {
  it("parses name/email/phone", () => {
    expect(
      parseAddFlags(["--name", "David Dworsky", "--email", "d@d.com", "--phone", "+33 6 12 34 56 78"]),
    ).toEqual({ name: "David Dworsky", email: "d@d.com", phone: "+33 6 12 34 56 78", fromOther: undefined });
  });

  it("parses --from-other with --phone enrichment", () => {
    expect(parseAddFlags(["--from-other", "otherContacts/c123", "--phone", "06 12 34 56 78"])).toEqual({
      name: undefined,
      email: undefined,
      phone: "06 12 34 56 78",
      fromOther: "otherContacts/c123",
    });
  });

  it("rejects --name with --from-other", () => {
    expect(() => parseAddFlags(["--from-other", "otherContacts/c1", "--name", "X"])).toThrow(
      /--name cannot be combined with --from-other/,
    );
  });

  it("rejects an empty invocation", () => {
    expect(() => parseAddFlags([])).toThrow(/Nothing to add/);
  });
});
