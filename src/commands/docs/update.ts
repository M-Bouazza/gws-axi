import { AxiError } from "axi-sdk-js";
import type { docs_v1 } from "googleapis";
import { docsClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";
import { buildReplaceAllRequest, requireFindReplace } from "../../util/replace-all.js";

export const UPDATE_HELP = `usage: gws-axi docs update <documentId> --find <text> --replace <text> [flags]
args[1]:
  <documentId>        The document ID (the portion of the URL after /d/)
flags[3]:
  --find <text>       Exact text to search for (e.g. '{{Client}}')
  --replace <text>    Replacement text; '' (empty string) deletes matches
  --match-case        Match casing exactly (default: case-insensitive)
examples:
  gws-axi docs update 1BxAbc... --find "2025" --replace "2026"
  gws-axi docs update 1BxAbc... --find '{{Client}}' --replace "Cospirit"
output:
  A \`document{id,title}\` header plus an \`updated{requests,replaced,match_case,
  write_id}\` block reporting what the API changed.
notes:
  Wraps documents.batchUpdate replaceAllText — an in-place targeted edit that
  preserves styles, images and tables, unlike the \`drive upload --convert\`
  round trip which rewrites the whole document. Replaces EVERY occurrence
  document-wide; \`updated.replaced: 0\` means nothing matched. Requires
  --account <email> when 2+ accounts are authenticated.
`;

export interface DocsUpdateFlags {
  documentId: string;
  find?: string;
  replace?: string;
  matchCase: boolean;
}

export function parseFlags(args: string[]): DocsUpdateFlags {
  let documentId: string | undefined;
  let find: string | undefined;
  let replace: string | undefined;
  let matchCase = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (documentId === undefined) documentId = arg;
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
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi docs update --help\` to see available flags`,
        ]);
    }
  }
  if (documentId === undefined) {
    throw new AxiError("Missing documentId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi docs update <documentId> --find <text> --replace <text>",
    ]);
  }
  requireFindReplace(find, replace, matchCase);
  return { documentId, find, replace, matchCase };
}

export async function docsUpdateCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const criteria = requireFindReplace(flags.find, flags.replace, flags.matchCase);
  const api = await docsClient(account);

  // Fetch the title so the report names the document it changed, and let the
  // 404 path distinguish a wrong id from an access problem.
  let title: string;
  try {
    const res = await api.documents.get({
      documentId: flags.documentId,
      fields: "title",
    });
    title = res.data.title ?? flags.documentId;
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "docs.documents.get",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Document '${flags.documentId}' not found (or ${account} doesn't have access)`,
        "DOCUMENT_NOT_FOUND",
        [
          `Verify the document ID is correct (the portion of the URL after /d/)`,
          `Confirm ${account} has at least view access to the document`,
        ],
      );
    }
    throw translated;
  }

  const requests: docs_v1.Schema$Request[] = [buildReplaceAllRequest(criteria)];
  let writeId: string | undefined;
  let replaced = 0;
  try {
    const res = await api.documents.batchUpdate({
      documentId: flags.documentId,
      requestBody: { requests },
    });
    // googleapis typings expose the post-write revision via writeControl
    // (requiredRevisionId / targetRevisionId); newer API responses carry
    // writeId at the root. Accept all spellings, root writeId wins.
    const batchResponse = res.data as docs_v1.Schema$BatchUpdateDocumentResponse & {
      writeId?: string | null;
    };
    writeId =
      batchResponse.writeId ??
      batchResponse.writeControl?.requiredRevisionId ??
      batchResponse.writeControl?.targetRevisionId ??
      undefined;
    replaced = (res.data.replies ?? []).reduce(
      (sum, reply) => sum + (reply.replaceAllText?.occurrencesChanged ?? 0),
      0,
    );
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "docs.documents.batchUpdate" });
  }

  const blocks = [
    renderObject({
      account,
      document: {
        id: flags.documentId,
        title,
      },
      updated: {
        requests: requests.length,
        replaced,
        match_case: criteria.matchCase,
        write_id: writeId,
      },
    }),
    renderHelp([
      `Verify with: gws-axi docs find ${flags.documentId} --query ${JSON.stringify(criteria.replace === "" ? criteria.find : criteria.replace)}`,
      "replaceAllText replaces EVERY occurrence document-wide; replaced: 0 means nothing matched — check casing and spacing",
    ]),
  ];
  return joinBlocks(...blocks);
}
