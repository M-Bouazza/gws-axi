import { describe, expect, it } from "vitest";
import { parseFlags } from "./get.js";

describe("parseFlags", () => {
  it("takes the positional formId", () => {
    expect(parseFlags(["1AbC"])).toEqual({ formId: "1AbC" });
  });

  it("takes the first non-flag argument as the formId", () => {
    expect(parseFlags(["--help", "1AbC"]).formId).toBe("1AbC");
  });

  it("rejects a missing formId", () => {
    expect(() => parseFlags([])).toThrow(/Missing formId/);
    expect(() => parseFlags(["--help"])).toThrow(/Missing formId/);
  });
});