import { AxiError } from "axi-sdk-js";
import type { people_v1 } from "googleapis";
import { peopleClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
  type FieldDef,
} from "../../output/index.js";
import { personRow, PERSON_FIELDS } from "./rows.js";

export const CONTACTS_LIST_HELP = `usage: gws-axi contacts list [flags]
flags[3]:
  --limit <n>          Max contacts to return (default: 100, max: 1000)
  --page <token>       Fetch the next page (from a prior \`next_page\` hint)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts list
  gws-axi contacts list --limit 500
output:
  A \`contacts[N]{id,name,email,phone}\` table over MY saved contacts
  (the People/Contacts group, not Other Contacts — use \`contacts other\`).
notes:
  \`id\` is the resourceName (people/c...) consumed by \`contacts update\`.
  When a next_page hint appears, more contacts exist — pass the token to
  --page. Requires --account <email> when 2+ accounts are authenticated.
`;

export interface ContactsListFlags {
  limit: number;
  page?: string;
}

export function parseFlags(args: string[]): ContactsListFlags {
  let limit = 100;
  let page: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 100 : Math.max(1, Math.min(1000, n));
        break;
      }
      case "--page":
        page = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi contacts list --help\` to see available flags`,
        ]);
    }
  }
  return { limit, page };
}

export const CONTACTS_SCHEMA: FieldDef[] = [
  field("id"),
  field("prenom"),
  field("nom"),
  field("entreprise"),
  field("email"),
  field("phone"),
];

export async function contactsListCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await peopleClient(account);
  let connections: people_v1.Schema$Person[];
  let nextPageToken: string | undefined;
  try {
    const res = await api.people.connections.list({
      resourceName: "people/me",
      pageSize: flags.limit,
      ...(flags.page !== undefined ? { pageToken: flags.page } : {}),
      personFields: PERSON_FIELDS,
      sortOrder: "FIRST_NAME_ASCENDING",
    });
    connections = res.data.connections ?? [];
    nextPageToken = res.data.nextPageToken ?? undefined;
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "people.connections.list" });
  }

  const rows = connections.map((p) => personRow(p));
  const suggestions: string[] = [];
  if (nextPageToken) {
    suggestions.push(`More contacts exist — re-run with --page ${nextPageToken}`);
  }
  suggestions.push("People you emailed but never saved live in Other Contacts: `gws-axi contacts other`");

  return joinBlocks(
    renderObject({ account, count: rows.length }),
    renderListResponse({
      name: "contacts",
      items: rows,
      schema: CONTACTS_SCHEMA,
      emptyMessage: "no contacts saved yet — see `contacts other` for people you interacted with",
    }),
    renderHelp(suggestions),
  );
}
