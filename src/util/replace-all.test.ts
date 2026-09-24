import { describe, expect, it } from "vitest";
import {
  buildReplaceAllRequest,
  requireFindReplace,
  resolveSlideScope,
  scopeReplaceAllToPages,
} from "./replace-all.js";

describe("requireFindReplace", () => {
  it("resolves the criteria bundle", () => {
    expect(requireFindReplace("x", "y", true)).toEqual({ find: "x", replace: "y", matchCase: true });
    expect(requireFindReplace("x", "y", false)).toEqual({
      find: "x",
      replace: "y",
      matchCase: false,
    });
  });

  it("accepts an empty --replace (deletion)", () => {
    expect(requireFindReplace("x", "", false)).toEqual({ find: "x", replace: "", matchCase: false });
  });

  it("rejects a missing or empty --find", () => {
    expect(() => requireFindReplace(undefined, "y", false)).toThrow(/--find/);
    expect(() => requireFindReplace("", "y", false)).toThrow(/--find/);
  });

  it("rejects a missing --replace but keeps the empty-string form", () => {
    expect(() => requireFindReplace("x", undefined, false)).toThrow(/--replace/);
  });
});

describe("buildReplaceAllRequest", () => {
  it("carries find/replace and the case criteria", () => {
    expect(buildReplaceAllRequest({ find: "{{Client}}", replace: "Cospirit", matchCase: false })).toEqual({
      replaceAllText: {
        containsText: { text: "{{Client}}", matchCase: false },
        replaceText: "Cospirit",
      },
    });
  });

  it("carries a case-sensitive criteria", () => {
    const r = buildReplaceAllRequest({ find: "ok", replace: "OK", matchCase: true });
    expect(r.replaceAllText.containsText).toEqual({ text: "ok", matchCase: true });
  });
});

describe("scopeReplaceAllToPages", () => {
  it("sets pageIds on the request", () => {
    const r = scopeReplaceAllToPages(buildReplaceAllRequest({ find: "x", replace: "y", matchCase: false }), [
      "p1",
      "p2",
    ]);
    expect(r.replaceAllText.pageIds).toEqual(["p1", "p2"]);
  });
});

describe("resolveSlideScope", () => {
  it("returns undefined when scoped to the whole deck", () => {
    expect(resolveSlideScope(["p1"], undefined)).toBeUndefined();
  });

  it("returns known page ids untouched", () => {
    expect(resolveSlideScope(["p1", "p2"], ["p2"])).toEqual(["p2"]);
  });

  it("rejects unknown page ids with the available list", () => {
    expect(() => resolveSlideScope(["p1", "p2"], ["p9"])).toThrow(/Page id 'p9' not found/);
    try {
      resolveSlideScope(["p1", "p2"], ["p9"]);
    } catch (err) {
      const axi = err as { message: string; suggestions: string[] };
      expect(axi.suggestions.join(" | ")).toContain("p1, p2");
    }
  });
});
