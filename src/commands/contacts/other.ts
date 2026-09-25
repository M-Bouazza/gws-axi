import { AxiError } from "axi-sdk-js";
import { peopleClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
  type FieldDef,
} from "../../output/index.js";
import { personRow } from "./rows.js";

export const CONTACTS_OTHER_HELP = `usage: gws-axi contacts other [flags]
flags[3]:
  --limit <n>          Max other contacts to return (default: 100, max: 1000)
  --page <token>       Fetch the next page (from a prior \`next_page\` hint)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts other
  gws-axi contacts other --limit 500
output:
  An \`others[N]{id,name,email,phone}\` table over OTHER CONTACTS: people
  you interacted with via Gmail/Drive without ever saving them.
notes:
  This IS the native "people I exchanged with" list — no Gmail scanning
  needed. \`id\` is an otherContacts/... resourceName consumed by
  \`contacts add --from-other\`. Requires --account <email> when 2+ accounts
  are authenticated (and the contacts.other.readonly scope).
`;

export interface ContactsOtherFlags {
  limit: number;
  page?: string;
}

export function parseFlags(args: string[]): ContactsOtherFlags {
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
          `Run \`gws-axi contacts other --help\` to see available flags`,
        ]);
    }
  }
  return { limit, page };
}

const OTHER_SCHEMA: FieldDef[] = [
  field("id"),
  field("prenom"),
  field("nom"),
  field("entreprise"),
  field("email"),
  field("phone"),
];

export async function contactsOtherCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await peopleClient(account);
  let others: Array<Record<string, unknown>> = [];
  let nextPageToken: string | undefined;
  try {
    const res = await api.otherContacts.list({
      pageSize: flags.limit,
      ...(flags.page !== undefined ? { pageToken: flags.page } : {}),
      // organizations is NOT allowed on otherContacts read requests (400).
      readMask: "names,emailAddresses,phoneNumbers",
    });
    others = (res.data.otherContacts ?? []).map((p) => personRow(p));
    nextPageToken = res.data.nextPageToken ?? undefined;
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "people.otherContacts.list" });
  }

  const suggestions: string[] = [];
  if (nextPageToken) {
    suggestions.push(`More other contacts exist — re-run with --page ${nextPageToken}`);
  }
  suggestions.push("Save one: gws-axi contacts add --from-other <id> [--phone <num>]");

  return joinBlocks(
    renderObject({ account, count: others.length }),
    renderListResponse({
      name: "others",
      items: others,
      schema: OTHER_SCHEMA,
      emptyMessage: "no other contacts returned — re-consent via `gws auth login` if contacts.other.readonly is missing",
    }),
    renderHelp(suggestions),
  );
}
