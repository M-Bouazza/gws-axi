import { describe, expect, it } from "vitest";
import { parseFlags, parseQuiz } from "./update.js";

describe("parseQuiz", () => {
  it("accepts true/false in common spellings", () => {
    expect(parseQuiz("true")).toBe(true);
    expect(parseQuiz("TRUE")).toBe(true);
    expect(parseQuiz("yes")).toBe(true);
    expect(parseQuiz("false")).toBe(false);
    expect(parseQuiz("no")).toBe(false);
  });

  it("rejects anything else", () => {
    expect(() => parseQuiz("1")).toThrow(/--quiz expects true or false/);
  });
});

describe("parseFlags", () => {
  it("parses a full argument set", () => {
    expect(
      parseFlags(["1AbC", "--title", "Diagnostic", "--description", "", "--quiz", "true", "--collect-email", "verified"]),
    ).toEqual({
      formId: "1AbC",
      title: "Diagnostic",
      description: "",
      quiz: true,
      collectEmail: "VERIFIED",
    });
  });

  it("maps --collect-email modes to the API enum", () => {
    expect(parseFlags(["1AbC", "--collect-email", "off"]).collectEmail).toBe("DO_NOT_COLLECT");
    expect(parseFlags(["1AbC", "--collect-email", "optional"]).collectEmail).toBe(
      "RESPONDER_INPUT",
    );
    expect(parseFlags(["1AbC", "--collect-email", "verified"]).collectEmail).toBe("VERIFIED");
    // underscores and dashes are equivalent
    expect(parseFlags(["1AbC", "--collect-email", "do-not-collect"]).collectEmail).toBe(
      "DO_NOT_COLLECT",
    );
    expect(parseFlags(["1AbC", "--collect-email", "responder-input"]).collectEmail).toBe(
      "RESPONDER_INPUT",
    );
  });

  it("takes the first non-flag argument as the formId", () => {
    expect(parseFlags(["--title", "x", "1AbC"]).formId).toBe("1AbC");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["1AbC", "--title", "x", "--publish"])).toThrow(
      /Unknown flag: --publish/,
    );
  });

  it("rejects a missing formId", () => {
    expect(() => parseFlags(["--title", "x"])).toThrow(/Missing formId/);
  });

  it("rejects an invocation with no target fields", () => {
    expect(() => parseFlags(["1AbC"])).toThrow(/Nothing to update/);
  });

  it("rejects an invalid --quiz value", () => {
    expect(() => parseFlags(["1AbC", "--quiz", "maybe"])).toThrow(/--quiz expects true or false/);
  });

  it("rejects an invalid --collect-email mode", () => {
    expect(() => parseFlags(["1AbC", "--collect-email", "always"])).toThrow(
      /must be one of off, optional, verified/,
    );
  });
});