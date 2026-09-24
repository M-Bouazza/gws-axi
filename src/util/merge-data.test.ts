import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  interpolateName,
  parseDataObject,
  parseRowsSelector,
  projectGridRows,
  replacementPairs,
  scalarToString,
} from "./merge-data.js";

describe("scalarToString", () => {
  it("maps scalars to strings and nullish to empty", () => {
    expect(scalarToString("x")).toBe("x");
    expect(scalarToString(5500)).toBe("5500");
    expect(scalarToString(true)).toBe("true");
    expect(scalarToString(null)).toBe("");
    expect(scalarToString(undefined)).toBe("");
  });
});

describe("parseDataObject — inline JSON", () => {
  it("parses a flat object with mixed scalars", () => {
    expect(parseDataObject('{"Client":"Djuce","Amount":5500,"Accepted":true,"Note":null}')).toEqual({
      Client: "Djuce",
      Amount: "5500",
      Accepted: "true",
      Note: "",
    });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseDataObject("{Client:Djuce}")).toThrow(/failed to parse/);
  });

  it("rejects non-object payloads", () => {
    expect(() => parseDataObject('["a","b"]')).toThrow(/flat object/);
    expect(() => parseDataObject("null")).toThrow(/flat object/);
  });

  it("rejects nested values", () => {
    expect(() => parseDataObject('{"Client":"a","Meta":{"x":1}}')).toThrow(/nested value/);
    try {
      parseDataObject('{"Client":"a","Meta":{"x":1}}');
    } catch (err) {
      const axi = err as { message: string };
      expect(axi.message).toContain("Meta");
    }
  });

  it("rejects an empty payload", () => {
    expect(() => parseDataObject("   ")).toThrow(/--data is empty/);
  });
});

describe("parseDataObject — @file", () => {
  it("loads a payload from an @path", () => {
    const dir = mkdtempSync(join(tmpdir(), "gws-merge-test-"));
    const path = join(dir, "payload.json");
    writeFileSync(path, '{"Client":"Djuce"}');
    expect(parseDataObject(`@${path}`)).toEqual({ Client: "Djuce" });
  });

  it("treats a missing @path as an error", () => {
    expect(() => parseDataObject("@/no/such/payload.json")).toThrow(/ENOENT|no such file/i);
  });

  it("falls back to inline when the raw payload is not a file path", () => {
    expect(parseDataObject('{"Client":"Djuce"}')).toEqual({ Client: "Djuce" });
  });
});

describe("replacementPairs", () => {
  it("wraps keys in {{}} braces", () => {
    expect(replacementPairs({ Client: "Djuce", Date: "24/09" })).toEqual([
      { find: "{{Client}}", replace: "Djuce" },
      { find: "{{Date}}", replace: "24/09" },
    ]);
  });

  it("sorts longest keys first so a prefix key can't clobber a longer placeholder", () => {
    const pairs = replacementPairs({ Client: "A", ClientName: "B" });
    expect(pairs.map((p) => p.find)).toEqual(["{{ClientName}}", "{{Client}}"]);
  });
});

describe("interpolateName", () => {
  it("replaces known placeholders and leaves unknown ones", () => {
    const data = { Client: "Djuce", Date: "24/09" };
    expect(interpolateName("Propale {{Client}} - {{Date}}", data)).toBe("Propale Djuce - 24/09");
    expect(interpolateName("Propale {{Client}} {{Inconnu}}", data)).toBe(
      "Propale Djuce {{Inconnu}}",
    );
  });
});

describe("parseRowsSelector", () => {
  it("defaults to all", () => {
    expect(parseRowsSelector(undefined)).toBe("all");
    expect(parseRowsSelector("")).toBe("all");
    expect(parseRowsSelector("ALL")).toBe("all");
  });

  it("parses singles, ranges and mixes", () => {
    expect(parseRowsSelector("1,3")).toEqual([1, 3]);
    expect(parseRowsSelector("1-3")).toEqual([1, 2, 3]);
    expect(parseRowsSelector("1-3,7")).toEqual([1, 2, 3, 7]);
  });

  it("rejects invalid selectors", () => {
    expect(() => parseRowsSelector("0")).toThrow(/Invalid --rows value/);
    expect(() => parseRowsSelector("3-1")).toThrow(/Invalid --rows range/);
    expect(() => parseRowsSelector("x")).toThrow(/Invalid --rows value/);
    expect(() => parseRowsSelector(" , ")).toThrow(/resolved to no row/);
  });
});

describe("projectGridRows", () => {
  const grid = [
    ["Client", "Date", ""], // empty header → col3
    ["Djuce", "24/09", "x"],
    [], // fully empty row → skipped
    ["Mecanicus", "01/10"], // ragged → col3 padded to ""
  ];

  it("promotes the first row to keys and projects all data rows", () => {
    expect(projectGridRows(grid, "all")).toEqual([
      { Client: "Djuce", Date: "24/09", col3: "x" },
      { Client: "Mecanicus", Date: "01/10", col3: "" },
    ]);
  });

  it("selects 1-indexed data rows in order", () => {
    expect(projectGridRows(grid, [3])).toEqual([
      { Client: "Mecanicus", Date: "01/10", col3: "" },
    ]);
  });

  it("skips an explicitly selected fully-empty row", () => {
    expect(projectGridRows(grid, [2])).toEqual([]);
  });

  it("returns empty for a header-only or empty grid", () => {
    expect(projectGridRows([["Client"]], "all")).toEqual([]);
    expect(projectGridRows([], "all")).toEqual([]);
  });

  it("ignores selected rows beyond the grid", () => {
    expect(projectGridRows(grid, [1, 9])).toEqual([{ Client: "Djuce", Date: "24/09", col3: "x" }]);
  });
});
