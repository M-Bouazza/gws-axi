import { describe, expect, it } from "vitest";
import { parseFlags, parseScopeList } from "./update.js";

describe("parseScopeList", () => {
  it("returns undefined when no --scope given", () => {
    expect(parseScopeList(undefined)).toBeUndefined();
  });

  it("splits comma-separated page ids and trims whitespace", () => {
    expect(parseScopeList("p1,p2")).toEqual(["p1", "p2"]);
    expect(parseScopeList(" p1 , p2 ")).toEqual(["p1", "p2"]);
  });

  it("keeps a single page id", () => {
    expect(parseScopeList("p1")).toEqual(["p1"]);
  });

  it("rejects an empty --scope", () => {
    expect(() => parseScopeList("")).toThrow(/--scope is empty/);
    expect(() => parseScopeList("  ,  ")).toThrow(/--scope is empty/);
  });
});

describe("parseFlags", () => {
  it("parses find/replace with the positional presentationId", () => {
    expect(parseFlags(["1AbC", "--find", "2025", "--replace", "2026"])).toEqual({
      presentationId: "1AbC",
      find: "2025",
      replace: "2026",
      matchCase: false,
      scope: undefined,
    });
  });

  it("defaults match-case to false and honors --match-case", () => {
    expect(parseFlags(["1AbC", "--find", "x", "--replace", "y"]).matchCase).toBe(false);
    expect(
      parseFlags(["1AbC", "--find", "x", "--replace", "y", "--match-case"]).matchCase,
    ).toBe(true);
  });

  it("parses a --scope of page ids", () => {
    expect(parseFlags(["1AbC", "--find", "x", "--replace", "y", "--scope", "p1,p2"]).scope).toEqual(
      ["p1", "p2"],
    );
  });

  it("takes the first non-flag argument as the presentationId", () => {
    expect(parseFlags(["--find", "x", "--replace", "y", "1AbC"]).presentationId).toBe("1AbC");
  });

  it("allows an empty --replace (deletion)", () => {
    expect(parseFlags(["1AbC", "--find", "x", "--replace", ""]).replace).toBe("");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["1AbC", "--find", "x", "--replace", "y", "--slide"])).toThrow(
      /Unknown flag: --slide/,
    );
  });

  it("rejects a missing presentationId", () => {
    expect(() => parseFlags(["--find", "x", "--replace", "y"])).toThrow(/Missing presentationId/);
  });

  it("rejects a missing or empty --find", () => {
    expect(() => parseFlags(["1AbC", "--replace", "y"])).toThrow(/--find/);
    expect(() => parseFlags(["1AbC", "--find", "", "--replace", "y"])).toThrow(/--find/);
  });

  it("rejects a missing --replace", () => {
    expect(() => parseFlags(["1AbC", "--find", "x"])).toThrow(/--replace/);
  });

  it("rejects an empty --scope", () => {
    expect(() => parseFlags(["1AbC", "--find", "x", "--replace", "y", "--scope", ""])).toThrow(
      /--scope is empty/,
    );
  });
});
