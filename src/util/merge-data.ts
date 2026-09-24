import { readFileSync } from "node:fs";
import { AxiError } from "axi-sdk-js";

/**
 * Pure helpers for the `merge` command: template + data objects → find/replace
 * pairs. The shared shape with Docs/Slides batchUpdate comes from
 * util/replace-all (buildReplaceAllRequest).
 */

/** Flatten a scalar to its string form (null/undefined → ""). */
export function scalarToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Parse --data into a flat {key: stringValue} object. Accepts inline JSON
 * (`'{"Client":"Djuce"}'`) or '@<path>' / an existing file path. Values must
 * be scalars (string/number/boolean/null); nested objects/arrays are rejected.
 */
export function parseDataObject(
  raw: string,
  readFile: (path: string) => string = defaultReadFile,
): Record<string, string> {
  let text = raw;
  if (raw.startsWith("@")) {
    text = readFile(raw.slice(1));
  } else {
    try {
      text = readFile(raw);
    } catch {
      text = raw;
    }
  }
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new AxiError("--data is empty — provide a flat JSON object", "VALIDATION_ERROR", [
      'Example: --data \'{"Client":"Djuce","Date":"24/09/2026"}\' or --data @payload.json',
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new AxiError(
      `--data looks like JSON but failed to parse: ${err instanceof Error ? err.message : String(err)}`,
      "VALIDATION_ERROR",
      ['Expected a flat object: {"Key":"value", ...} — one entry per {{Key}} placeholder'],
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AxiError("--data JSON must be a flat object of scalar values", "VALIDATION_ERROR", [
      'Example: {"Client":"Djuce","Amount":5500,"Accepted":true}',
    ]);
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value !== null && typeof value === "object") {
      throw new AxiError(
        `--data key '${key}' has a nested value — only scalars (string, number, boolean, null) are supported`,
        "VALIDATION_ERROR",
        [`Flatten '${key}' into scalar fields before merging`],
      );
    }
    out[key] = scalarToString(value);
  }
  return out;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Turn a flat data object into replaceAllText requests' find strings.
 * Keys are sorted longest-first so a key that is a prefix of another can't
 * clobber its neighbor's placeholder inside a value cascade.
 */
export function replacementPairs(data: Record<string, string>): Array<{ find: string; replace: string }> {
  return Object.entries(data)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([key, value]) => ({ find: `{{${key}}}`, replace: value }));
}

/** Interpolate {{Key}} placeholders in a name template; unknown keys are left as-is. */
export function interpolateName(name: string, data: Record<string, string>): string {
  return name.replace(/\{\{([^{}]+)\}\}/g, (whole, key: string) => {
    const value = data[key];
    return value === undefined ? whole : value;
  });
}

/**
 * Parse a --rows selector into data-row indexes (1-indexed, AFTER the header
 * row): "all" | "1,3,5" | "1-3,7". Returns "all" when omitted.
 */
export function parseRowsSelector(selector: string | undefined): "all" | number[] {
  if (selector === undefined) return "all";
  const normalized = selector.trim().toLowerCase();
  if (normalized === "" || normalized === "all") return "all";
  const indexes: number[] = [];
  for (const part of normalized.split(",")) {
    const chunk = part.trim();
    if (chunk === "") continue;
    const range = chunk.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        throw new AxiError(`Invalid --rows range '${chunk}'`, "VALIDATION_ERROR", [
          "Rows are 1-indexed over the data rows (the header row is consumed as column names)",
          "Example: --rows 1-3,7",
        ]);
      }
      for (let i = start; i <= end; i++) indexes.push(i);
      continue;
    }
    const single = Number(chunk);
    if (!Number.isInteger(single) || single < 1) {
      throw new AxiError(`Invalid --rows value '${chunk}'`, "VALIDATION_ERROR", [
        "Rows are 1-indexed over the data rows (the header row is consumed as column names)",
        "Example: --rows all | --rows 1,3 | --rows 1-3,7",
      ]);
    }
    indexes.push(single);
  }
  if (indexes.length === 0) {
    throw new AxiError("--rows resolved to no row", "VALIDATION_ERROR", [
      "Example: --rows all | --rows 1,3 | --rows 1-3,7",
    ]);
  }
  return indexes;
}

/**
 * Project a sheet grid (first row = headers) into data objects. Ragged rows
 * are padded with "". Selector picks which 1-indexed data rows to keep.
 */
export function projectGridRows(
  grid: unknown[][],
  selector: "all" | number[],
): Array<Record<string, string>> {
  if (grid.length < 2) return [];
  const headers = grid[0].map((h, i) => {
    const name = scalarToString(h).trim();
    return name !== "" ? name : `col${i + 1}`;
  });
  const wanted =
    selector === "all"
      ? grid.slice(1).map((_, i) => i + 1)
      : [...selector].sort((a, b) => a - b);
  const out: Array<Record<string, string>> = [];
  for (const index of wanted) {
    const row = grid[index] ?? [];
    if (index < 1 || index >= grid.length) continue;
    const record: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, i) => {
      const value = scalarToString(row[i]);
      record[header] = value;
      if (value !== "") hasValue = true;
    });
    // Fully empty rows (blank sheet lines) produce an empty deliverable — skip
    // them rather than copying the template with nothing replaced.
    if (hasValue) out.push(record);
  }
  return out;
}
