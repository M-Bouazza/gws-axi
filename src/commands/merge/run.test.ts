import { describe, expect, it } from "vitest";
import { parseFlags } from "./run.js";

describe("parseFlags", () => {
  it("parses a --data invocation", () => {
    expect(
      parseFlags(["1Tpl", "--data", '{"Client":"Djuce"}', "--name", "Propale {{Client}}"]),
    ).toEqual({
      templateId: "1Tpl",
      data: '{"Client":"Djuce"}',
      from: undefined,
      tab: undefined,
      rows: undefined,
      name: "Propale {{Client}}",
      folder: undefined,
    });
  });

  it("parses a --from invocation with series options", () => {
    expect(
      parseFlags(["1Tpl", "--from", "1Sht", "--tab", "Clients", "--rows", "1-3", "--folder", "1Fld"]),
    ).toEqual({
      templateId: "1Tpl",
      data: undefined,
      from: "1Sht",
      tab: "Clients",
      rows: "1-3",
      name: undefined,
      folder: "1Fld",
    });
  });

  it("takes the first non-flag argument as the templateId", () => {
    expect(parseFlags(["--data", "{}", "1Tpl"]).templateId).toBe("1Tpl");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["1Tpl", "--data", "{}", "--find", "x"])).toThrow(
      /Unknown flag: --find/,
    );
  });

  it("rejects a missing templateId", () => {
    expect(() => parseFlags(["--data", "{}"])).toThrow(/Missing templateId/);
  });

  it("rejects --data and --from together", () => {
    expect(() => parseFlags(["1Tpl", "--data", "{}", "--from", "1Sht"])).toThrow(
      /mutually exclusive/,
    );
  });

  it("rejects a missing data source", () => {
    expect(() => parseFlags(["1Tpl"])).toThrow(/Missing data source/);
  });

  it("rejects --tab / --rows without --from", () => {
    expect(() => parseFlags(["1Tpl", "--data", "{}", "--rows", "1"])).toThrow(
      /only apply with --from/,
    );
    expect(() => parseFlags(["1Tpl", "--data", "{}", "--tab", "Clients"])).toThrow(
      /only apply with --from/,
    );
  });
});
