import { describe, expect, it } from "vitest";
import { parseFlags } from "./list.js";
import { parseFlags as parseDoneFlags } from "./done.js";

describe("tasks list — parseFlags", () => {
  it("defaults listId, showDone and limit", () => {
    expect(parseFlags([])).toEqual({ listId: undefined, showDone: false, limit: 50 });
  });

  it("parses a positional listId with flags", () => {
    expect(parseFlags(["MDkyMDgz", "--show-done", "--limit", "100"])).toEqual({
      listId: "MDkyMDgz",
      showDone: true,
      limit: 100,
    });
  });

  it("caps the limit at 200 and floors at 1", () => {
    expect(parseFlags(["--limit", "500"]).limit).toBe(200);
    expect(parseFlags(["--limit", "0"]).limit).toBe(1);
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["--completed"])).toThrow(/Unknown flag: --completed/);
  });
});

describe("tasks done — parseFlags", () => {
  it("parses the positional taskId", () => {
    expect(parseDoneFlags(["MDkyMDgzNTox"])).toEqual({ taskId: "MDkyMDgzNTox", list: undefined });
  });

  it("parses --list", () => {
    expect(parseDoneFlags(["MDkyMDgzNTox", "--list", "MDkyMDgz"])).toEqual({
      taskId: "MDkyMDgzNTox",
      list: "MDkyMDgz",
    });
  });

  it("rejects a missing taskId", () => {
    expect(() => parseDoneFlags([])).toThrow(/Missing taskId/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseDoneFlags(["x", "--purge"])).toThrow(/Unknown flag: --purge/);
  });
});
