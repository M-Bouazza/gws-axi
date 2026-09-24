import { readFileSync, statSync } from "node:fs";
import { AxiError } from "axi-sdk-js";
import { sheetsClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const UPDATE_HELP = `usage: gws-axi sheets update <spreadsheetId> --tab <name> --range <A1> --values <json|csv|@file> [flags]
args[1]:
  <spreadsheetId>      The spreadsheet ID (the portion of the URL after /d/)
flags[5]:
  --tab <name|gid>     Tab to write (by title or numeric sheetId). Omit when
                       --range carries a tab qualifier (Costs!A1:B2)
  --range <A1>         Target range within the tab (e.g. B5, A1:C3). Defaults
                       to A1. A tab-qualified range makes --tab optional
  --values <json|csv>  2D JSON array of rows ([[a,b],[c,d]]) or CSV text.
                       '@<path>' reads the payload from a local file
  --input <mode>       valueInputOption: 'user' (USER_ENTERED, default — the
                       sheet parses formulas/numbers/dates) or 'raw' (RAW —
                       literal strings, no parsing)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi sheets update 1AbC... --tab Costs --range B2 --values '"OK"'
  gws-axi sheets update 1AbC... --tab Costs --range A1:B2 --values '[["a",1],["b",2]]'
  gws-axi sheets update 1AbC... --range 'Costs!B2' --values @payload.csv
output:
  A \`spreadsheet{id,title,tab}\` header plus an \`updated{range,rows,cols,cells,
  input_option}\` block reporting what the API wrote.
notes:
  Wraps spreadsheets.values.update — a per-range write, unlike
  \`drive upload --convert\` which replaces the whole file. Values are written
  starting at the range's top-left; the sheet is NOT cleared beyond the written
  rectangle. Requires --account <email> when 2+ accounts are authenticated.
`;

/** Split a possibly tab-qualified A1 range into { tabTitle?, a1 }. */
export function splitQualifiedRange(range: string): { tabTitle?: string; a1: string } {
  if (range.startsWith("'")) {
    const close = range.indexOf("'!", 1);
    if (close !== -1) {
      return {
        tabTitle: range.slice(1, close).replace(/''/g, "'"),
        a1: range.slice(close + 2),
      };
    }
  }
  const bang = range.lastIndexOf("!");
  if (bang !== -1) {
    return { tabTitle: range.slice(0, bang), a1: range.slice(bang + 1) };
  }
  return { a1: range };
}

/** Quote a tab title for use in an A1 reference. */
export function quoteTitle(title: string): string {
  return /^[A-Za-z0-9_]+$/.test(title) ? title : `'${title.replace(/'/g, "''")}'`;
}

/** Parse CSV text (RFC 4180: quoted fields, "" escapes, CRLF/LF). */
export function parseCsv(text: string): unknown[][] {
  const rows: unknown[][] = [];
  let row: unknown[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const push = (): void => {
    row.push(cell);
    cell = "";
  };
  const endRow = (): void => {
    push();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      push();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Final cell/row when the payload doesn't end with a newline.
  if (cell !== "" || row.length > 0) {
    push();
    rows.push(row);
  }
  return rows;
}

function readPayloadFile(path: string): string {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new AxiError(
      `--values file not found: ${path}`,
      "VALIDATION_ERROR",
      [
        "Pass inline JSON/CSV, or prefix a file path with '@' (e.g. --values @payload.csv)",
      ],
    );
  }
  if (!stat.isFile()) {
    throw new AxiError(`--values path is not a file: ${path}`, "VALIDATION_ERROR", []);
  }
  return readFileSync(path, "utf8");
}

/**
 * Resolve --values into a 2D array. JSON must be an array of arrays (cells may
 * be string/number/boolean/null); anything else is parsed as CSV. A leading '@'
 * or an existing-file path loads the payload from disk.
 */
export function parseValues(raw: string): unknown[][] {
  let text = raw;
  if (raw.startsWith("@")) {
    text = readPayloadFile(raw.slice(1));
  } else {
    try {
      if (statSync(raw).isFile()) text = readFileSync(raw, "utf8");
    } catch {
      // Not a path — treat as inline payload.
    }
  }
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new AxiError(
      "--values is empty — provide a JSON 2D array or CSV text",
      "VALIDATION_ERROR",
      [
        'Example: --values \'[["a","b"],["c","d"]]\' or --values @payload.csv',
      ],
    );
  }
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new AxiError(
        `--values looks like JSON but failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        "VALIDATION_ERROR",
        ['Expected a 2D array: [["row1col1","row1col2"],["row2col1"]]'],
      );
    }
    if (!Array.isArray(parsed) || !parsed.every((r) => Array.isArray(r))) {
      throw new AxiError(
        "--values JSON must be a 2D array of rows",
        "VALIDATION_ERROR",
        ['Example: [["a","b"],["c","d"]]'],
      );
    }
    return (parsed as unknown[][]).map((row) =>
      row.map((cell) => (cell === null || cell === undefined ? "" : cell)),
    );
  }
  return parseCsv(text);
}

export interface UpdateFlags {
  spreadsheetId: string;
  tab?: string;
  range?: string;
  values: string;
  input: "user" | "raw";
}

export function parseFlags(args: string[]): UpdateFlags {
  let spreadsheetId: string | undefined;
  let tab: string | undefined;
  let range: string | undefined;
  let values: string | undefined;
  let input: "user" | "raw" = "user";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (spreadsheetId === undefined) spreadsheetId = arg;
      continue;
    }
    switch (arg) {
      case "--tab":
        tab = args[++i];
        break;
      case "--range":
        range = args[++i];
        break;
      case "--values":
        values = args[++i];
        break;
      case "--input":
        input = args[++i] as "user" | "raw";
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi sheets update --help\` to see available flags`,
        ]);
    }
  }
  if (spreadsheetId === undefined) {
    throw new AxiError("Missing spreadsheetId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi sheets update <spreadsheetId> --tab <name> --range <A1> --values <json|csv>",
    ]);
  }
  if (!values) {
    throw new AxiError("Missing --values — nothing to write", "VALIDATION_ERROR", [
      "Example: --values '[[\"a\",\"b\"]]' or --values @payload.csv",
    ]);
  }
  if (input !== "user" && input !== "raw") {
    throw new AxiError(
      `--input must be 'user' or 'raw' (got '${input}')`,
      "VALIDATION_ERROR",
      [
        "'user' = USER_ENTERED (sheet parses formulas/numbers), 'raw' = RAW (literal strings)",
      ],
    );
  }
  return { spreadsheetId, tab, range, values, input };
}

/** Default a bare-relative range to A1 (parseRangeOrigin degrades the same way). */
export function ensureA1(a1: string): string {
  return a1 && a1.trim() !== "" ? a1 : "A1";
}

export async function sheetsUpdateCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const { tabTitle, a1: rangeA1 } = splitQualifiedRange(flags.range ?? "");
  const selector = flags.tab ?? tabTitle;
  const api = await sheetsClient(account);
  // Resolve the tab so the write range is always tab-qualified — values.update
  // against a bare A1 would hit the first tab regardless of intent.
  let targetTitle: string;
  try {
    const res = await api.spreadsheets.get({
      spreadsheetId: flags.spreadsheetId,
      fields: "properties.title,sheets(properties(sheetId,title,sheetType))",
    });
    const gridSheets = (res.data.sheets ?? [])
      .map((s) => s.properties)
      .filter((p): p is NonNullable<typeof p> => !!p && (p.sheetType ?? "GRID") === "GRID");
    if (selector !== undefined) {
      const target =
        gridSheets.find((p) => p.title === selector) ??
        gridSheets.find((p) => String(p.sheetId) === selector);
      if (!target?.title) {
        throw new AxiError(
          `Tab '${selector}' not found in spreadsheet '${flags.spreadsheetId}'`,
          "TAB_NOT_FOUND",
          [
            `Available tabs: ${gridSheets.map((p) => p.title).join(", ") || "none"}`,
            `Run \`gws-axi sheets read ${flags.spreadsheetId}\` to list tabs`,
          ],
        );
      }
      targetTitle = target.title;
    } else if (gridSheets.length === 1) {
      targetTitle = gridSheets[0].title ?? "Sheet1";
    } else {
      throw new AxiError(
        "Multiple tabs and no --tab — pass --tab <name> or a tab-qualified range (Costs!A1)",
        "TAB_REQUIRED",
        [`Available tabs: ${gridSheets.map((p) => p.title).join(", ")}`],
      );
    }
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const translated = translateGoogleError(err, {
      account,
      operation: "sheets.spreadsheets.get",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Spreadsheet '${flags.spreadsheetId}' not found (or ${account} doesn't have access)`,
        "SPREADSHEET_NOT_FOUND",
        [
          "Verify the spreadsheet ID is correct (the portion of the URL after /d/)",
          `Confirm ${account} has edit access`,
        ],
      );
    }
    throw translated;
  }
  const values = parseValues(flags.values);
  const a1 = `${quoteTitle(targetTitle)}!${ensureA1(rangeA1)}`;
  const valueInputOption = flags.input === "raw" ? "RAW" : "USER_ENTERED";
  let updatedRange: string;
  try {
    const res = await api.spreadsheets.values.update({
      spreadsheetId: flags.spreadsheetId,
      range: a1,
      valueInputOption,
      requestBody: { values },
    });
    updatedRange = res.data.updatedRange ?? a1;
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "sheets.values.update" });
  }
  const rows = values.length;
  const cols = values.reduce((w, r) => Math.max(w, r.length), 0);
  const blocks = [
    renderObject({
      account,
      spreadsheet: {
        id: flags.spreadsheetId,
        tab: targetTitle,
      },
      updated: {
        range: updatedRange,
        rows,
        cols,
        cells: rows * cols,
        input_option: valueInputOption,
      },
    }),
    renderHelp([
      `Verify with: gws-axi sheets read ${flags.spreadsheetId} --tab ${quoteTitle(targetTitle)} --range ${ensureA1(rangeA1)}`,
      "Values are written from the range's top-left; cells outside the written rectangle are untouched",
    ]),
  ];
  return joinBlocks(...blocks);
}
