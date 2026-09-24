import { AxiError } from "axi-sdk-js";
import { resolveAccount, withAccountSource } from "../google/account.js";
import { notImplemented, renderAlternatives, withInstead } from "./stub-signposts.js";
import { docsCommentsCommand } from "./docs/comments.js";
import { formsGetCommand, GET_HELP } from "./forms/get.js";
import { formsUpdateCommand, UPDATE_HELP } from "./forms/update.js";

// Forms comments are Drive comments — the same file-agnostic API `docs
// comments` / `slides comments` / `sheets comments` use. Alias the shared
// handler with a form-worded resource label + not-found code.
const COMMENTS_HELP = `usage: gws-axi forms comments <form-id> [--include-resolved] [flags]
args[1]:
  <form-id>            The Google Form ID (the portion of the URL after /d/e/)
flags[2]:
  --include-resolved   Include resolved comment threads (hidden by default)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi forms comments 1AbC...
output:
  A \`comments[N]{id,author,created,resolved,quoted_content,body,reply_count}\`
  table plus a \`replies[N]{comment,author,created,body}\` block.
notes:
  Forms comments are Drive comments (file-type-agnostic); this is the same
  data as \`gws-axi docs comments\` / \`gws-axi sheets comments\`.
`;

const formsCommentsCommand = (account: string, args: string[]): Promise<string> =>
  docsCommentsCommand(account, args, {
    resource: "form",
    notFoundCode: "FORM_NOT_FOUND",
  });

interface FormsSubcommand {
  name: string;
  mutation: boolean;
  help: string;
  handler?: (account: string, args: string[]) => Promise<string>;
  instead?: string[];
}

// Item writes need createItem/updateItem over structured questions — a
// different model from text replacement. Kept as stubs with signposts.
const CREATE_HELP = `usage: gws-axi forms create --title <text> [--from <template-id>] [flags]
status: planned for v1 writes — not yet implemented
`;
const QUESTION_ADD_HELP = `usage: gws-axi forms question-add <formId> --index <n> --title <text> [flags]
status: planned for writes — not yet implemented
notes:
  Will wrap forms.batchUpdate createItem. Questions are structured items, not
  free text — the surface will grow from real needs.
`;
const QUESTION_UPDATE_HELP = `usage: gws-axi forms question-update <formId> --item <itemId> [flags]
status: planned for writes — not yet implemented
`;
const QUESTION_DELETE_HELP = `usage: gws-axi forms question-delete <formId> --item <itemId> [flags]
status: planned for writes — not yet implemented
`;
const RESPONSES_HELP = `usage: gws-axi forms responses <formId> [flags]
status: intentionally not implemented — responses accumulate in the linked Google Sheet
notes:
  \`forms get\` surfaces linked_sheet_id; read the responses grid with
  \`gws-axi sheets read\`. One mental model, one read command, zero new API.
`;

const UI_EDIT_SIGNPOST = [
  "Questions are structured items (not free text) — edit them in the Forms UI",
  "gws-axi forms get <form-id> lists items with their item_id for later item-level writes",
];

const RESPONSES_SIGNPOST = [
  "gws-axi forms get <form-id> — surfaces linked_sheet_id (responses accumulate in the linked Google Sheet)",
  "gws-axi sheets read <linked-sheet-id> — read the responses grid from the linked Sheet",
];

const SUBCOMMANDS: FormsSubcommand[] = [
  { name: "get", mutation: false, help: GET_HELP, handler: formsGetCommand },
  { name: "comments", mutation: false, help: COMMENTS_HELP, handler: formsCommentsCommand },
  { name: "update", mutation: true, help: UPDATE_HELP, handler: formsUpdateCommand },
  { name: "create", mutation: true, help: CREATE_HELP },
  { name: "responses", mutation: false, help: RESPONSES_HELP, instead: RESPONSES_SIGNPOST },
  { name: "question-add", mutation: true, help: QUESTION_ADD_HELP, instead: UI_EDIT_SIGNPOST },
  { name: "question-update", mutation: true, help: QUESTION_UPDATE_HELP, instead: UI_EDIT_SIGNPOST },
  { name: "question-delete", mutation: true, help: QUESTION_DELETE_HELP, instead: UI_EDIT_SIGNPOST },
];

const SUB_BY_NAME: Record<string, FormsSubcommand> = Object.fromEntries(
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

export const FORMS_HELP = `usage: gws-axi forms <subcommand> [args] [--account <email>] [flags]
reads[${reads.length}]:
  ${reads.join(", ")}
writes[${writes.length}]:
  ${writes.join(", ")}
notes:
  Writes require --account <email> when 2+ accounts are authenticated.
  Reads use the default account when --account is not provided.
  'update' (form-level settings) and 'get' are implemented; the remaining
  write subcommands are scaffolded — questions are structured items, so they
  are edited in the Forms UI for now. Responses are read through the linked
  Google Sheet via \`gws-axi sheets read\`.
${renderAlternatives(SUBCOMMANDS)}subcommand help:
  gws-axi forms get --help       for form structure + responder + linked sheet
  gws-axi forms update --help    for settings edits (title, quiz, email)
  gws-axi forms comments --help  for review comments (Drive comments)
examples:
  gws-axi forms get 1AbC...
  gws-axi forms update 1AbC... --title "Diagnostic process - Client X"
  gws-axi forms update 1AbC... --quiz true --collect-email verified
  gws-axi forms comments 1AbC...
`;

export async function formsCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return FORMS_HELP;
  }

  const sub = args[0];
  const def = SUB_BY_NAME[sub];
  if (!def) {
    throw new AxiError(`Unknown forms subcommand: ${sub}`, "VALIDATION_ERROR", [
      `Run \`gws-axi forms --help\` to see available subcommands`,
    ]);
  }

  const rest = args.slice(1);
  if (rest.includes("--help")) {
    return def.handler ? def.help : withInstead(def.help, def.instead);
  }

  const { account: accountFlag, rest: remaining } = parseAccountFlag(rest);
  const resolution = resolveAccount(accountFlag, {
    mutation: def.mutation,
    commandName: `forms ${sub}`,
  });

  if (!def.handler) {
    throw notImplemented("forms", sub, resolution.account, def.instead);
  }

  return withAccountSource(resolution, await def.handler(resolution.account, remaining));
}