import { describe, expect, it } from "vitest";
import { parseFlags } from "./update.js";

describe("parseFlags", () => {
  it("parses find/replace with the positional documentId", () => {
    expect(parseFlags(["1BxAbc", "--find", "2025", "--replace", "2026"])).toEqual({
      documentId: "1BxAbc",
      find: "2025",
      replace: "2026",
      matchCase: false,
    });
  });

  it("defaults match-case to false and honors --match-case", () => {
    expect(parseFlags(["1BxAbc", "--find", "x", "--replace", "y"]).matchCase).toBe(false);
    expect(
      parseFlags(["1BxAbc", "--find", "x", "--replace", "y", "--match-case"]).matchCase,
    ).toBe(true);
  });

  it("takes the first non-flag argument as the documentId", () => {
    expect(parseFlags(["--find", "x", "--replace", "y", "1BxAbc"]).documentId).toBe("1BxAbc");
  });

  it("allows an empty --replace (deletion)", () => {
    expect(parseFlags(["1BxAbc", "--find", "x", "--replace", ""]).replace).toBe("");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["1BxAbc", "--find", "x", "--replace", "y", "--bold"])).toThrow(
      /Unknown flag: --bold/,
    );
  });

  it("rejects a missing documentId", () => {
    expect(() => parseFlags(["--find", "x", "--replace", "y"])).toThrow(/Missing documentId/);
  });

  it("rejects a missing or empty --find", () => {
    expect(() => parseFlags(["1BxAbc", "--replace", "y"])).toThrow(/--find/);
    expect(() => parseFlags(["1BxAbc", "--find", "", "--replace", "y"])).toThrow(/--find/);
  });

  it("rejects a missing --replace", () => {
    expect(() => parseFlags(["1BxAbc", "--find", "x"])).toThrow(/--replace/);
  });
});
