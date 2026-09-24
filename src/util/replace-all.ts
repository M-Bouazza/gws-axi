import { AxiError } from "axi-sdk-js";

export interface FindReplaceCriteria {
  find: string;
  replace: string;
  matchCase: boolean;
}

/**
 * Shape shared by the Docs and Slides APIs: batchUpdate requests carry
 * replaceAllText with a substring-match criteria. Slides additionally allows
 * scoping to page ids; the field is optional so slides can set it and docs
 * leaves it unset.
 */
export interface ReplaceAllTextPayload {
  replaceAllText: {
    containsText: { text: string; matchCase: boolean };
    replaceText: string;
    pageIds?: string[];
  };
}

/** Validate --find/--replace and resolve the match-criteria bundle. */
export function requireFindReplace(
  find: string | undefined,
  replace: string | undefined,
  matchCase: boolean,
): FindReplaceCriteria {
  if (!find) {
    throw new AxiError("Missing or empty --find — nothing to search for", "VALIDATION_ERROR", [
      "Pass the exact text to search for (e.g. --find '{{Client}}')",
    ]);
  }
  // Empty --replace is valid — it deletes every occurrence of --find.
  if (replace === undefined) {
    throw new AxiError("Missing --replace — pass the replacement text", "VALIDATION_ERROR", [
      "Pass '' (empty string) to delete the matched text",
    ]);
  }
  return { find, replace, matchCase };
}

/** Build the batchUpdate replaceAllText request shared by Docs and Slides. */
export function buildReplaceAllRequest(criteria: FindReplaceCriteria): ReplaceAllTextPayload {
  return {
    replaceAllText: {
      containsText: { text: criteria.find, matchCase: criteria.matchCase },
      replaceText: criteria.replace,
    },
  };
}

/** Scope a Slides replaceAllText request to specific page ids. */
export function scopeReplaceAllToPages(
  request: ReplaceAllTextPayload,
  pageIds: string[],
): ReplaceAllTextPayload {
  request.replaceAllText.pageIds = pageIds;
  return request;
}

/**
 * Validate --scope page ids against a presentation's slides and return the
 * pageIds list (or undefined when scoped to the whole deck).
 */
export function resolveSlideScope(
  pageObjectIds: string[],
  scope: string[] | undefined,
): string[] | undefined {
  if (!scope) return undefined;
  const available = new Set(pageObjectIds);
  const unknown = scope.filter((id) => !available.has(id));
  if (unknown.length > 0) {
    throw new AxiError(`Page id '${unknown[0]}' not found in presentation`, "PAGE_NOT_FOUND", [
      `Available pages: ${pageObjectIds.join(", ") || "none"}`,
      "Run `gws-axi slides get <presentationId>` to list page ids",
    ]);
  }
  return scope;
}
