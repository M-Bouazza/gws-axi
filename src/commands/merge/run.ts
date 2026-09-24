import { AxiError } from "axi-sdk-js";
import type { drive_v3, docs_v1, slides_v1 } from "googleapis";
import {
  docsClient,
  driveClient,
  sheetsClient,
  slidesClient,
  translateGoogleError,
} from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderList,
  renderObject,
  type FieldDef,
} from "../../output/index.js";
import { quoteTitle } from "../sheets/update.js";
import { buildReplaceAllRequest } from "../../util/replace-all.js";
import {
  interpolateName,
  parseDataObject,
  parseRowsSelector,
  projectGridRows,
  replacementPairs,
} from "../../util/merge-data.js";

export const MERGE_RUN_HELP = `usage: gws-axi merge <templateId> (--data <json|@file> | --from <spreadsheetId>) [flags]
args[1]:
  <templateId>         Template file ID — a native Google Doc or Slides
                       presentation containing {{Key}} placeholders
data source (exactly one):
  --data <json|@file>  One flat JSON object (inline or '@<path>'):
                       '{"Client":"Djuce","Date":"24/09/2026"}'
  --from <sheetId>     Series source: a Spreadsheet whose header row holds the
                       placeholder keys, one deliverable per data row
flags[4]:
  --tab <name>         Tab of the --from sheet (default: first tab)
  --rows <selector>    Which --from rows to merge: all | 1,3 | 1-3,7
                       (1-indexed over data rows; default: all)
  --name <template>    Name for each copy, interpolated per row:
                       'Propale {{Client}} - {{Date}}' (default: Drive's
                       'Copy of <template title>')
  --folder <folderId>  Target folder for the copies (default: same parent as
                       the template)
examples:
  gws-axi merge 1Tpl... --data '{"Client":"Djuce","Date":"24/09/2026"}' --name "Propale {{Client}}"
  gws-axi merge 1Tpl... --from 1Sht... --tab Clients --rows 1-5 --name "Propale {{Client}}"
output:
  A \`template{id,type}\` header plus a \`merged[N]{id,name,requests,replaced}\`
  table — one row per generated copy.
notes:
  Per deliverable: Drive files.copy (the template is NEVER modified), then a
  single batchUpdate replaceAllText pass over the copy — every {{Key}} in the
  data object is replaced everywhere (styles, images and tables preserved).
  Placeholders without a matching data key stay as-is in the copy. Caps at 50
  deliverables per run. Requires --account <email> when 2+ accounts are
  authenticated.
`;

const MAX_COPIES = 50;
const DOC_MIME = "application/vnd.google-apps.document";
const SLIDES_MIME = "application/vnd.google-apps.presentation";

export interface MergeRunFlags {
  templateId: string;
  data?: string;
  from?: string;
  tab?: string;
  rows?: string;
  name?: string;
  folder?: string;
}

export function parseFlags(args: string[]): MergeRunFlags {
  let templateId: string | undefined;
  let data: string | undefined;
  let from: string | undefined;
  let tab: string | undefined;
  let rows: string | undefined;
  let name: string | undefined;
  let folder: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (templateId === undefined) templateId = arg;
      continue;
    }
    switch (arg) {
      case "--data":
        data = args[++i];
        break;
      case "--from":
        from = args[++i];
        break;
      case "--tab":
        tab = args[++i];
        break;
      case "--rows":
        rows = args[++i];
        break;
      case "--name":
        name = args[++i];
        break;
      case "--folder":
        folder = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi merge --help\` to see available flags`,
        ]);
    }
  }
  if (templateId === undefined) {
    throw new AxiError("Missing templateId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi merge <templateId> --data '{...}' | --from <spreadsheetId>",
    ]);
  }
  if (data !== undefined && from !== undefined) {
    throw new AxiError("--data and --from are mutually exclusive", "VALIDATION_ERROR", [
      "--data merges ONE deliverable from inline/file JSON",
      "--from merges a SERIES from a Spreadsheet (one deliverable per data row)",
    ]);
  }
  if (data === undefined && from === undefined) {
    throw new AxiError("Missing data source — pass --data or --from", "VALIDATION_ERROR", [
      'One deliverable: --data \'{"Client":"Djuce"}\'',
      "Series: --from <spreadsheetId> --tab <name> --rows all",
    ]);
  }
  if (data !== undefined && (tab !== undefined || rows !== undefined)) {
    throw new AxiError("--tab / --rows only apply with --from", "VALIDATION_ERROR", [
      "Series options pair with --from <spreadsheetId>; --data carries one object",
    ]);
  }
  return { templateId, data, from, tab, rows, name, folder };
}

type TemplateKind = "doc" | "slides";

async function resolveTemplate(
  account: string,
  templateId: string,
): Promise<{ kind: TemplateKind; title: string }> {
  const api = await driveClient(account);
  let file: drive_v3.Schema$File;
  try {
    const res = await api.files.get({
      fileId: templateId,
      fields: "name,mimeType",
      supportsAllDrives: true,
    });
    file = res.data;
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "drive.files.get",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Template '${templateId}' not found (or ${account} doesn't have access)`,
        "TEMPLATE_NOT_FOUND",
        [
          `Verify the template ID is correct (the portion of the URL after /d/)`,
          `Confirm ${account} has at least view access`,
        ],
      );
    }
    throw translated;
  }
  const mime = file.mimeType ?? "";
  if (mime === DOC_MIME) return { kind: "doc", title: file.name ?? templateId };
  if (mime === SLIDES_MIME) return { kind: "slides", title: file.name ?? templateId };
  throw new AxiError(
    `'${templateId}' is not a native Doc or Slides presentation (mime: ${mime})`,
    "UNSUPPORTED_TEMPLATE",
    [
      "Templates must be native Google Docs or Slides containing {{Key}} placeholders",
      "Convert a source file first: gws-axi drive upload <file> --convert",
    ],
  );
}

async function loadDataObjects(
  account: string,
  flags: MergeRunFlags,
): Promise<Array<Record<string, string>>> {
  if (flags.data !== undefined) {
    return [parseDataObject(flags.data)];
  }
  // Series source: --from <spreadsheetId> [--tab] [--rows]
  const selector = parseRowsSelector(flags.rows);
  const api = await sheetsClient(account);
  // values.get REQUIRES a range. With no --tab, resolve the spreadsheet's
  // first GRID tab and use its title as the range.
  let range: string | undefined = flags.tab !== undefined ? quoteTitle(flags.tab) : undefined;
  if (range === undefined) {
    try {
      const res = await api.spreadsheets.get({
        spreadsheetId: flags.from,
        fields: "sheets(properties(sheetId,title,sheetType))",
      });
      const firstGrid = (res.data.sheets ?? [])
        .map((s) => s.properties)
        .filter((p): p is NonNullable<typeof p> => !!p && (p.sheetType ?? "GRID") === "GRID")[0];
      if (!firstGrid?.title) {
        throw new AxiError(
          `Spreadsheet '${flags.from}' has no GRID tab to read`,
          "SPREADSHEET_NOT_FOUND",
          ["Create a data tab, or pass --tab <name> explicitly"],
        );
      }
      range = quoteTitle(firstGrid.title);
    } catch (err) {
      if (err instanceof AxiError) throw err;
      const translated = translateGoogleError(err, {
        account,
        operation: "sheets.spreadsheets.get",
      });
      if (translated.code === "NOT_FOUND") {
        throw new AxiError(
          `Spreadsheet '${flags.from}' not found (or ${account} doesn't have access)`,
          "SPREADSHEET_NOT_FOUND",
          ["Verify the spreadsheet ID", `Confirm ${account} has view access`],
        );
      }
      throw translated;
    }
  }
  let grid: unknown[][];
  try {
    const res = await api.spreadsheets.values.get({
      spreadsheetId: flags.from,
      ...(range !== undefined ? { range } : {}),
    });
    grid = res.data.values ?? [];
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "sheets.values.get",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Tab not found in spreadsheet '${flags.from}' (or ${account} doesn't have access)`,
        "TAB_NOT_FOUND",
        [
          `Verify the --tab name against \`gws-axi sheets read ${flags.from}\``,
          `Confirm ${account} has view access`,
        ],
      );
    }
    throw translated;
  }
  if (grid.length === 0) {
    throw new AxiError("Source sheet is empty — no header row to derive keys from", "VALIDATION_ERROR", [
      "The first row must hold the placeholder keys (e.g. Client | Date | Amount)",
    ]);
  }
  const objects = projectGridRows(grid, selector);
  if (objects.length === 0) {
    throw new AxiError(
      "No mergeable data rows — every selected row is empty",
      "VALIDATION_ERROR",
      [
        "Rows with at least one non-empty cell produce a deliverable; blank rows are skipped",
        `Check --rows ${flags.rows ?? "all"} against the sheet content`,
      ],
    );
  }
  return objects;
}

async function copyTemplate(
  account: string,
  flags: MergeRunFlags,
  name: string,
): Promise<string> {
  const api = await driveClient(account);
  try {
    const res = await api.files.copy({
      fileId: flags.templateId,
      ...(flags.folder !== undefined
        ? { requestBody: { name, parents: [flags.folder] } }
        : { requestBody: { name } }),
      fields: "id,name",
      supportsAllDrives: true,
    });
    return res.data.id ?? "";
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "drive.files.copy",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Template '${flags.templateId}' vanished mid-merge (or ${account} can't copy it)`,
        "TEMPLATE_NOT_FOUND",
        [`Confirm ${account} has copy access to the template`],
      );
    }
    throw translated;
  }
}

async function applyReplacements(
  account: string,
  kind: TemplateKind,
  copyId: string,
  criteria: Array<{ find: string; replace: string }>,
): Promise<number> {
  const requests = criteria.map((c) =>
    buildReplaceAllRequest({ find: c.find, replace: c.replace, matchCase: false }),
  );
  let replaced = 0;
  if (kind === "doc") {
    const api = await docsClient(account);
    try {
      const res = await api.documents.batchUpdate({
        documentId: copyId,
        requestBody: { requests: requests as docs_v1.Schema$Request[] },
      });
      replaced = (res.data.replies ?? []).reduce(
        (sum, reply) => sum + (reply.replaceAllText?.occurrencesChanged ?? 0),
        0,
      );
    } catch (err) {
      throw translateGoogleError(err, { account, operation: "docs.documents.batchUpdate" });
    }
  } else {
    const api = await slidesClient(account);
    try {
      const res = await api.presentations.batchUpdate({
        presentationId: copyId,
        requestBody: { requests: requests as slides_v1.Schema$Request[] },
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
  }
  return replaced;
}

export async function mergeRunCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const template = await resolveTemplate(account, flags.templateId);
  const objects = await loadDataObjects(account, flags);
  if (objects.length > MAX_COPIES) {
    throw new AxiError(
      `${objects.length} deliverables exceed the ${MAX_COPIES}-per-run cap`,
      "VALIDATION_ERROR",
      [`Split the series with --rows (e.g. --rows 1-${MAX_COPIES}, then --rows ${MAX_COPIES + 1}-...)`],
    );
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const data of objects) {
    const name = interpolateName(flags.name ?? `Copy of ${template.title}`, data);
    const copyId = await copyTemplate(account, flags, name);
    const criteria = replacementPairs(data);
    const replaced = await applyReplacements(account, template.kind, copyId, criteria);
    rows.push({ id: copyId, name, requests: criteria.length, replaced });
  }

  const schema: FieldDef[] = [
    field("id"),
    field("name"),
    field("requests"),
    field("replaced"),
  ];

  const verifyCommand = template.kind === "doc" ? "docs find" : "slides summarize";
  const verifyHints = rows
    .slice(0, 3)
    .map(
      (row, i) =>
        `Verify copy ${i + 1}: gws-axi ${verifyCommand} ${row.id}${template.kind === "doc" ? ` --query ${(replacementPairs(objects[i])[0]?.replace ?? "")}` : ""}`,
    );
  if (rows.length > 3) {
    verifyHints.push(`…and ${rows.length - 3} more copies`);
  }

  const blocks = [
    renderObject({ account }),
    renderObject({
      template: {
        id: flags.templateId,
        type: template.kind,
      },
    }),
    renderList("merged", rows, schema),
    renderHelp([
      "The template file itself was never modified — each row produced an independent Drive copy",
      ...verifyHints,
    ]),
  ];
  return joinBlocks(...blocks);
}