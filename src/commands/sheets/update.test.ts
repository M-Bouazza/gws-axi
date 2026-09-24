import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureA1,
  parseCsv,
  parseFlags,
  parseValues,
  quoteTitle,
  splitQualifiedRange,
} from "./update.js";

describe("splitQualifiedRange", () => {
  it("returns a bare range untouched", () => {
    expect(splitQualifiedRange("B2")).toEqual({ a1: "B2" });
    expect(splitQualifiedRange("A1:C3")).toEqual({ a1: "A1:C3" });
  });

  it("splits an unquoted tab qualifier", () => {
    expect(splitQualifiedRange("Costs!A1:B2")).toEqual({ tabTitle: "Costs", a1: "A1:B2" });
  });

  it("splits a quoted tab qualifier containing !", () => {
    expect(splitQualifiedRange("'My Sheet!x'!B10:D20")).toEqual({
      tabTitle: "My Sheet!x",
      a1: "B10:D20",
    });
  });

  it("un-escapes doubled quotes in a quoted qualifier", () => {
    expect(splitQualifiedRange("'O''Brien'!A1")).toEqual({ tabTitle: "O'Brien", a1: "A1" });
  });
});

describe("quoteTitle", () => {
  it("keeps simple titles unquoted", () => {
    expect(quoteTitle("Costs")).toBe("Costs");
    expect(quoteTitle("My_Sheet_2")).toBe("My_Sheet_2");
  });

  it("quotes titles with spaces or special characters", () => {
    expect(quoteTitle("My Costs")).toBe("'My Costs'");
    expect(quoteTitle("2024-Q1")).toBe("'2024-Q1'");
  });

  it("escapes single quotes by doubling", () => {
    expect(quoteTitle("O'Brien")).toBe("'O''Brien'");
  });
});

describe("parseCsv", () => {
  it("parses a simple grid", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    expect(parseCsv('"say ""hi""", x ,y')).toEqual([['say "hi"', " x ", "y"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a final row without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("parses a single cell payload", () => {
    expect(parseCsv("OK")).toEqual([["OK"]]);
  });
});

describe("parseValues — JSON", () => {
  it("accepts a 2D JSON array with mixed cell types", () => {
    expect(parseValues('[["a",1,true,null],["b",2,false]]')).toEqual([
      ["a", 1, true, ""],
      ["b", 2, false],
    ]);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseValues("[[a,b]]")).toThrow(/failed to parse/);
  });

  it("rejects JSON that is not a 2D array", () => {
    expect(() => parseValues("[1,2,3]")).toThrow(/must be a 2D array/);
  });

  it("rejects an empty payload", () => {
    expect(() => parseValues("   ")).toThrow(/--values is empty/);
  });
});

describe("parseValues — CSV fallback", () => {
  it("treats non-JSON payloads as CSV", () => {
    expect(parseValues("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("treats a bare string as a one-cell row", () => {
    expect(parseValues('"OK"')).toEqual([["OK"]]);
  });

  it("treats a JSON object payload as CSV, not an error", () => {
    // Only `[`-prefixed payloads take the JSON path; `{...}` degrades to CSV.
    expect(parseValues('{"a":1}')).toEqual([["{a:1}"]]);
  });
});

describe("parseValues — @file", () => {
  let dir: string;
  const mkTempPayload = (): string => {
    dir = mkdtempSync(join(tmpdir(), "gws-update-test-"));
    const path = join(dir, "payload.csv");
    writeFileSync(path, "Item,Qty\nWidgets,40\n");
    return path;
  };

  it("loads a payload from an @path", () => {
    expect(parseValues(`@${mkTempPayload()}`)).toEqual([
      ["Item", "Qty"],
      ["Widgets", "40"],
    ]);
  });

  it("rejects a missing file path with a helpful hint", () => {
    expect(() => parseValues("@/no/such/payload.csv")).toThrow(/file not found/);
  });

  it("loads an existing bare path without @", () => {
    const path = mkTempPayload();
    expect(parseValues(path)).toEqual([
      ["Item", "Qty"],
      ["Widgets", "40"],
    ]);
  });

  afterEach(() => {
    dir = "";
  });
});

describe("parseFlags", () => {
  it("parses a full argument set", () => {
    expect(
      parseFlags([
        "1AbC",
        "--tab",
        "Costs",
        "--range",
        "B2",
        "--values",
        '[["a"]]',
        "--input",
        "raw",
      ]),
    ).toEqual({
      spreadsheetId: "1AbC",
      tab: "Costs",
      range: "B2",
      values: '[["a"]]',
      input: "raw",
    });
  });

  it("defaults range and input", () => {
    expect(parseFlags(["1AbC", "--values", "x"])).toEqual({
      spreadsheetId: "1AbC",
      tab: undefined,
      range: undefined,
      values: "x",
      input: "user",
    });
  });

  it("takes the first non-flag argument as the spreadsheetId", () => {
    expect(parseFlags(["--values", "x", "1AbC"]).spreadsheetId).toBe("1AbC");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["1AbC", "--values", "x", "--tabb", "Costs"])).toThrow(
      /Unknown flag: --tabb/,
    );
  });

  it("rejects a missing spreadsheetId", () => {
    expect(() => parseFlags(["--values", "x"])).toThrow(/Missing spreadsheetId/);
  });

  it("rejects missing --values", () => {
    expect(() => parseFlags(["1AbC"])).toThrow(/Missing --values/);
  });

  it("rejects an invalid --input mode", () => {
    expect(() => parseFlags(["1AbC", "--values", "x", "--input", "fast"])).toThrow(
      /must be 'user' or 'raw'/,
    );
  });
});

describe("ensureA1", () => {
  it("keeps a real range and defaults an empty one to A1", () => {
    expect(ensureA1("B2:C3")).toBe("B2:C3");
    expect(ensureA1("")).toBe("A1");
    expect(ensureA1("  ")).toBe("A1");
  });
});
