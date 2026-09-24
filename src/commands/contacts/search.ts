import { AxiError } from "axi-sdk-js";
import { peopleClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";
import { personRow } from "./rows.js";

export const CONTACTS_SEARCH_HELP = `usage: gws-axi contacts search <query> [flags]
args[1]:
  <query>              Name, email fragment or phone fragment to search for
flags[3]:
  --limit <n>          Max results (default: 10, max: 30 — API cap)
  --include-other      Also search Other Contacts (people interacted with,
                       not saved) — needs contacts.other.readonly
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts search Djuce
  gws-axi contacts search david@djuce.com --include-other
output:
  A \`matches[N]{id,name,email,phone,source}\` table; \`source\` is
  "contact" (saved) or "other" (interacted-with).
notes:
  Wraps people.searchContacts (+ otherContacts.search with --include-other).
  The API matches on name, email, phone prefixes — not full-text. Requires
  --account <email> when 2+ accounts are authenticated.
`;

export interface ContactsSearchFlags {
  query: string;
  includeOther: boolean;
  limit: number;
}

export function parseFlags(args: string[]): ContactsSearchFlags {
  let query: string | undefined;
  let includeOther = false;
  let limit = 10;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (query === undefined) query = arg;
      continue;
    }
    switch (arg) {
      case "--include-other":
        includeOther = true;
        break;
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 10 : Math.max(1, Math.min(30, n));
        break;
      }
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi contacts search --help\` to see available flags`,
        ]);
    }
  }
  if (query === undefined) {
    throw new AxiError("Missing search query", "VALIDATION_ERROR", [
      "Usage: gws-axi contacts search <query> [--include-other]",
    ]);
  }
  return { query, includeOther, limit };
}

export async function contactsSearchCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await peopleClient(account);

  const rows: Array<Record<string, unknown>> = [];
  try {
    const res = await api.people.searchContacts({
      query: flags.query,
      pageSize: flags.limit,
      readMask: "names,emailAddresses,phoneNumbers",
    });
    for (const result of res.data.results ?? []) {
      const person = result.person;
      if (!person) continue;
      rows.push({ ...personRow(person), source: "contact" });
    }
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "people.searchContacts" });
  }

  if (flags.includeOther) {
    try {
      const res = await api.otherContacts.search({
        query: flags.query,
        pageSize: flags.limit,
        readMask: "names,emailAddresses,phoneNumbers",
      });
      for (const result of res.data.results ?? []) {
        const person = result.person;
        if (!person) continue;
        const row = personRow(person);
        if (rows.some((r) => r.id === row.id)) continue;
        rows.push({ ...row, source: "other" });
      }
    } catch (err) {
      throw translateGoogleError(err, { account, operation: "people.otherContacts.search" });
    }
  }

  const suggestions: string[] = [];
  if (!flags.includeOther) {
    suggestions.push("Also search unsaved people with: --include-other");
  }
  suggestions.push("Update a saved contact: gws-axi contacts update <id> --phone <num>");

  return joinBlocks(
    renderObject({ account, query: flags.query }),
    renderListResponse({
      name: "matches",
      items: rows,
      schema: [
        field("id"),
        field("name"),
        field("email"),
        field("phone"),
        field("source"),
      ],
      emptyMessage: `no match for "${flags.query}"${flags.includeOther ? "" : " in saved contacts (try --include-other)"}`,
    }),
    renderHelp(suggestions),
  );
}
