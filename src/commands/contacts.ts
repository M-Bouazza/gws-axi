import { AxiError } from "axi-sdk-js";
import { resolveAccount, withAccountSource } from "../google/account.js";
import { notImplemented, renderAlternatives, withInstead } from "./stub-signposts.js";
import { CONTACTS_ADD_HELP, contactsAddCommand } from "./contacts/add.js";
import { CONTACTS_ENRICH_HELP, contactsEnrichCommand } from "./contacts/enrich.js";
import {
  CONTACTS_LIST_HELP,
  contactsListCommand,
} from "./contacts/list.js";
import { contactsOtherCommand, CONTACTS_OTHER_HELP } from "./contacts/other.js";
import { contactsScanCommand, CONTACTS_SCAN_HELP } from "./contacts/scan.js";
import { contactsSearchCommand, CONTACTS_SEARCH_HELP } from "./contacts/search.js";
import { contactsUpdateCommand, CONTACTS_UPDATE_HELP } from "./contacts/update.js";

interface ContactsSubcommand {
  name: string;
  mutation: boolean;
  help: string;
  handler?: (account: string, args: string[]) => Promise<string>;
  instead?: string[];
}

const DELETE_HELP = `usage: gws-axi contacts delete <contactId> [flags]
status: planned — not yet implemented
notes:
  Will wrap people.deleteContact (destructive). Hidden in the meantime:
  deletion happens in the Contacts UI.
`;

const SUBCOMMANDS: ContactsSubcommand[] = [
  { name: "list", mutation: false, help: CONTACTS_LIST_HELP, handler: contactsListCommand },
  { name: "other", mutation: false, help: CONTACTS_OTHER_HELP, handler: contactsOtherCommand },
  { name: "search", mutation: false, help: CONTACTS_SEARCH_HELP, handler: contactsSearchCommand },
  { name: "scan-signatures", mutation: false, help: CONTACTS_SCAN_HELP, handler: contactsScanCommand },
  { name: "enrich", mutation: true, help: CONTACTS_ENRICH_HELP, handler: contactsEnrichCommand },
  { name: "add", mutation: true, help: CONTACTS_ADD_HELP, handler: contactsAddCommand },
  { name: "update", mutation: true, help: CONTACTS_UPDATE_HELP, handler: contactsUpdateCommand },
  { name: "delete", mutation: true, help: DELETE_HELP },
];

const SUB_BY_NAME: Record<string, ContactsSubcommand> = Object.fromEntries(
  SUBCOMMANDS.map((s) => [s.name, s]),
);

function parseAccountFlag(args: string[]): {
  account: string | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let account: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--account" && args[i + 1]) {
      account = args[i + 1];
      i++;
      continue;
    }
    rest.push(arg);
  }
  return { account, rest };
}

const reads = SUBCOMMANDS.filter((s) => !s.mutation).map((s) => s.name);
const writes = SUBCOMMANDS.filter((s) => s.mutation).map((s) => s.name);

export const CONTACTS_HELP = `usage: gws-axi contacts <subcommand> [args] [--account <email>] [flags]
reads[${reads.length}]:
  ${reads.join(", ")}
writes[${writes.length}]:
  ${writes.join(", ")}
notes:
  Writes require --account <email> when 2+ accounts are authenticated.
  Reads use the default account when --account is not provided.
  'list'/'other'/'search'/'scan-signatures'/'enrich' and 'add'/'update' are
  implemented; delete is scaffolded (destructive — use the Contacts UI).
  Other Contacts = people interacted with via Gmail/Drive but never saved.
${renderAlternatives(SUBCOMMANDS)}subcommand help:
  gws-axi contacts list --help   for saved contacts enumeration
  gws-axi contacts other --help  for interacted-with people (no Gmail scan needed)
  gws-axi contacts search --help for name/email/phone lookup
  gws-axi contacts scan-signatures --help  for FR phone proposals from Gmail bodies
  gws-axi contacts enrich --help for systematic phone + company enrichment
  gws-axi contacts add --help    for creating / promoting / enriching
  gws-axi contacts update --help for merged in-place edits
examples:
  gws-axi contacts list
  gws-axi contacts other
  gws-axi contacts search Djuce --include-other
  gws-axi contacts scan-signatures --query "from:david@djuce.com"
  gws-axi contacts enrich --apply --limit 100
  gws-axi contacts add --name "David Dworsky" --company Djuce --email david@djuce.com --phone "06 12 34 56 78"
  gws-axi contacts update people/c456 --phone "06 12 34 56 78" --company Djuce
`;

export async function contactsCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return CONTACTS_HELP;
  }

  const sub = args[0];
  const def = SUB_BY_NAME[sub];
  if (!def) {
    throw new AxiError(`Unknown contacts subcommand: ${sub}`, "VALIDATION_ERROR", [
      `Run \`gws-axi contacts --help\` to see available subcommands`,
    ]);
  }

  const rest = args.slice(1);
  if (rest.includes("--help")) {
    return def.handler ? def.help : withInstead(def.help, def.instead);
  }

  const { account: accountFlag, rest: remaining } = parseAccountFlag(rest);
  const resolution = resolveAccount(accountFlag, {
    mutation: def.mutation,
    commandName: `contacts ${sub}`,
  });

  if (!def.handler) {
    throw notImplemented("contacts", sub, resolution.account, def.instead);
  }

  return withAccountSource(resolution, await def.handler(resolution.account, remaining));
}
