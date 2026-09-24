import { describe, expect, it } from "vitest";
import {
  deduceCompanyFromDomain,
  parseFlags,
} from "./enrich.js";

describe("deduceCompanyFromDomain", () => {
  it("deduces from a standard domain", () => {
    expect(deduceCompanyFromDomain("guillaume.humbert@interflora.fr")).toBe("Interflora");
    expect(deduceCompanyFromDomain("david@djuce.com")).toBe("Djuce");
    expect(deduceCompanyFromDomain("paul.bourdois@francescpi.com")).toBe("Francescpi");
  });

  it("splits dashes into words", () => {
    expect(deduceCompanyFromDomain("guillaume@matthieu-tranvan.fr")).toBe("Matthieu Tranvan");
  });

  it("handles a three-part domain with a co-TLD", () => {
    expect(deduceCompanyFromDomain("x@fabernovel.ey.com")).toBe("Fabernovel");
  });

  it("returns empty for generic providers", () => {
    expect(deduceCompanyFromDomain("mehdi@gmail.com")).toBe("");
    expect(deduceCompanyFromDomain("x@outlook.com")).toBe("");
    expect(deduceCompanyFromDomain("x@orange.fr")).toBe("");
  });

  it("returns empty for infra prefixes", () => {
    expect(deduceCompanyFromDomain("x@mail.corp.com")).toBe("");
    expect(deduceCompanyFromDomain("x@www.site.fr")).toBe("");
  });

  it("returns empty for a missing @", () => {
    expect(deduceCompanyFromDomain("no-domain")).toBe("");
  });
});

describe("parseFlags", () => {
  it("defaults limit to 50 and apply to false", () => {
    expect(parseFlags([])).toEqual({ limit: 50, apply: false });
  });

  it("parses --limit and --apply", () => {
    expect(parseFlags(["--limit", "100", "--apply"])).toEqual({ limit: 100, apply: true });
  });

  it("caps limit at 200", () => {
    expect(parseFlags(["--limit", "500"]).limit).toBe(200);
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["--query", "x"])).toThrow(/Unknown flag: --query/);
  });
});
