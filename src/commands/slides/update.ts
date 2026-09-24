import { AxiError } from "axi-sdk-js";
import type { slides_v1 } from "googleapis";
import { slidesClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";
import {
  buildReplaceAllRequest,
  requireFindReplace,
  resolveSlideScope,
  scopeReplaceAllToPages,
} from "../../util/replace-all.js";

export const UPDATE_HELP = `usage: gws-axi slides update <presentation-id> --find <text> --replace <text> [flags]
args[1]:
  <presentation-id>   The Slides presentation ID (the portion of the URL after /d/)
flags[4]:
  --find <text>       Exact text to search for (e.g. '{{Client}}')
  --replace <text>    Replacement text; '' (empty string) deletes matches
  --match-case        Match casing exactly (default: case-insensitive)
  --scope <ids>       Comma-separated page ids (from \`slides get\`) to limit the
                      edit to those slides. Default: the whole deck
examples:
  gws-axi slides update 1AbC... --find "2025" --replace "2026"
  gws-axi slides update 1AbC... --find '{{Client}}' --replace "Cospirit"
output:
  A \`presentation{id,title}\` header plus an \`updated{requests,replaced,
  match_case,scope}\` block reporting what the API changed.
notes:
  Wraps presentations.batchUpdate replaceAllText — an in-place targeted edit
  that preserves layouts, images and tables, unlike \`drive upload --convert\`
  which rewrites the whole deck as a new revision. Replaces EVERY occurrence
  (whole deck by default, or the --scope pages); \`updated.replaced: 0\` means
  nothing matched. Requires --account <email> when 2+ accounts are
  authenticated.
`;

export interface SlidesUpdateFlags {
  presentationId: string;
  find?: string;
  replace?: string;
  matchCase: boolean;
  scope?: string[];
}

export function parseScopeList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    throw new AxiError("--scope is empty — pass at least one page id", "VALIDATION_ERROR", [
      "Get page ids from `gws-axi slides get <presentation-id>` (the page_id column)",
      "Example: --scope gd87cbcb3a4_0_42,gd87cbcb3a4_0_43",
    ]);
  }
  return ids;
}

export function parseFlags(args: string[]): SlidesUpdateFlags {
  let presentationId: string | undefined;
  let find: string | undefined;
  let replace: string | undefined;
  let matchCase = false;
  let scopeRaw: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (presentationId === undefined) presentationId = arg;
      continue;
    }
    switch (arg) {
      case "--find":
        find = args[++i];
        break;
      case "--replace":
        replace = args[++i];
        break;
      case "--match-case":
        matchCase = true;
        break;
      case "--scope":
        scopeRaw = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi slides update --help\` to see available flags`,
        ]);
    }
  }
  if (presentationId === undefined) {
    throw new AxiError("Missing presentationId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi slides update <presentation-id> --find <text> --replace <text>",
    ]);
  }
  requireFindReplace(find, replace, matchCase);
  return {
    presentationId,
    find,
    replace,
    matchCase,
    scope: parseScopeList(scopeRaw),
  };
}

export async function slidesUpdateCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const criteria = requireFindReplace(flags.find, flags.replace, flags.matchCase);
  const api = await slidesClient(account);

  // Fetch title + page ids so the report names the deck, the scope is
  // validated before the write, and the 404 path distinguishes a wrong id
  // from an access problem.
  let title: string;
  let pageObjectIds: string[];
  try {
    const res = await api.presentations.get({
      presentationId: flags.presentationId,
      fields: "title,slides(objectId)",
    });
    title = res.data.title ?? flags.presentationId;
    pageObjectIds = (res.data.slides ?? [])
      .map((page) => page.objectId ?? "")
      .filter((id) => id !== "");
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "slides.presentations.get",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Presentation '${flags.presentationId}' not found (or ${account} doesn't have access)`,
        "PRESENTATION_NOT_FOUND",
        [
          `Verify the presentation ID is correct (the portion of the URL after /d/)`,
          `Confirm ${account} has at least view access to the deck`,
        ],
      );
    }
    throw translated;
  }

  const scope = resolveSlideScope(pageObjectIds, flags.scope);
  let request = buildReplaceAllRequest(criteria);
  if (scope) {
    request = scopeReplaceAllToPages(request, scope);
  }

  let replaced = 0;
  try {
    const res = await api.presentations.batchUpdate({
      presentationId: flags.presentationId,
      requestBody: {
        requests: [request as slides_v1.Schema$Request],
      },
    });
    replaced = (res.data.replies ?? []).reduce(
      (sum, reply) => sum + (reply.replaceAllText?.occurrencesChanged ?? 0),
      0,
    );
  } catch (err) {
    throw translateGoogleError(err, {
      account,
      operation: "slides.presentations.batchUpdate",
    });
  }

  const blocks = [
    renderObject({
      account,
      presentation: {
        id: flags.presentationId,
        title,
      },
      updated: {
        requests: 1,
        replaced,
        match_case: criteria.matchCase,
        scope: scope ? scope.join(", ") : "whole deck",
      },
    }),
    renderHelp([
      `Verify with: gws-axi slides summarize ${flags.presentationId} — the replaced text should show up in the rendered markdown`,
      "replaceAllText replaces EVERY occurrence (deck-wide or --scope pages); replaced: 0 means nothing matched — check casing and spacing",
    ]),
  ];
  return joinBlocks(...blocks);
}
