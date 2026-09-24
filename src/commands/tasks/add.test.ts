import { describe, expect, it } from "vitest";
import { normalizeDue, parseFlags } from "./add.js";

describe("normalizeDue", () => {
  it("expands YYYY-MM-DD to end-of-day UTC", () => {
    expect(normalizeDue("2026-09-28")).toBe("2026-09-28T23:59:59.000Z");
  });

  it("passes full dates through as ISO", () => {
    expect(normalizeDue("2026-09-28T14:00:00Z")).toMatch(/^2026-09-28T14:00:00\.000Z$/);
    expect(normalizeDue("2026-09-28T16:00:00+02:00")).toBe("2026-09-28T14:00:00.000Z");
  });

  it("rejects garbage dates", () => {
    expect(() => normalizeDue("demain")).toThrow(/--due must be YYYY-MM-DD or an RFC3339/);
    expect(() => normalizeDue("2026-13-40")).toThrow(/--due must be/);
  });
});

describe("parseFlags", () => {
  it("parses a minimal add (title only)", () => {
    expect(parseFlags(["Relancer le devis"])).toEqual({
      title: "Relancer le devis",
      notes: undefined,
      list: undefined,
    });
  });

  it("parses a full add", () => {
    const flags = parseFlags([
      "Call kickoff",
      "--due",
      "2026-09-28",
      "--notes",
      "14h-16h",
      "--list",
      "MDkyMDgz",
    ]);
    expect(flags.title).toBe("Call kickoff");
    expect(flags.due).toBe("2026-09-28T23:59:59.000Z");
    expect(flags.notes).toBe("14h-16h");
    expect(flags.list).toBe("MDkyMDgz");
  });

  it("takes the first non-flag argument as the title", () => {
    expect(parseFlags(["--due", "2026-09-28", "Relancer"]).title).toBe("Relancer");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["x", "--priority", "high"])).toThrow(/Unknown flag: --priority/);
  });

  it("rejects a missing title", () => {
    expect(() => parseFlags(["--notes", "x"])).toThrow(/Missing task title/);
  });

  it("rejects an invalid --due", () => {
    expect(() => parseFlags(["x", "--due", "soon"])).toThrow(/--due must be/);
  });
});
