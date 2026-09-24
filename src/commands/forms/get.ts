import { AxiError } from "axi-sdk-js";
import type { forms_v1 } from "googleapis";
import { formsClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";

export const GET_HELP = `usage: gws-axi forms get <form-id> [flags]
args[1]:
  <formId>             The Google Form ID (from the URL after /d/e/)
flags[1]:
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi forms get 1AbC...
output:
  A \`form{id,title,revision_id,responder_uri,linked_sheet_id}\` header plus an
  \`items[N]{index,item_id,type,title,description}\` table — one row per item
  (questions, page breaks, section headers, text/image/video blocks).
notes:
  Responses accumulate in the linked Google Sheet — read them with
  \`gws-axi sheets read <linked-sheet-id>\` (the sheet gets one tab per
  response view). Editing is limited to form-level settings via
  \`gws-axi forms update <form-id>\`; questions are edited in the Forms UI.
  Requires --account <email> when 2+ accounts are authenticated.
`;

interface ParsedFlags {
  formId: string;
}

export function parseFlags(args: string[]): ParsedFlags {
  let formId: string | undefined;
  for (const arg of args) {
    if (!arg.startsWith("--") && formId === undefined) {
      formId = arg;
    }
  }
  if (!formId) {
    throw new AxiError("Missing formId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi forms get <form-id>",
    ]);
  }
  return { formId };
}

type ItemType =
  | "question"
  | "question-group"
  | "page-break"
  | "section-header"
  | "text"
  | "image"
  | "video";

function itemRow(item: forms_v1.Schema$Item, index: number): Record<string, unknown> {
  let type: ItemType = "section-header";
  if (item.questionGroupItem) type = "question-group";
  else if (item.questionItem) type = "question";
  else if (item.pageBreakItem) type = "page-break";
  else if (item.textItem) type = "text";
  else if (item.imageItem) type = "image";
  else if (item.videoItem) type = "video";
  const row: Record<string, unknown> = {
    index,
    item_id: item.itemId ?? "",
    type,
    title: item.title ?? "",
    description: item.description ?? "",
  };
  return row;
}

export async function formsGetCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await formsClient(account);

  let form: forms_v1.Schema$Form;
  try {
    const res = await api.forms.get({ formId: flags.formId });
    form = res.data;
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "forms.forms.get",
    });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Form '${flags.formId}' not found (or ${account} doesn't have access)`,
        "FORM_NOT_FOUND",
        [
          `Verify the form ID is correct (the portion of the URL after /d/e/)`,
          `Confirm ${account} has at least view access to the form`,
        ],
      );
    }
    throw translated;
  }

  const items = form.items ?? [];
  const rows = items.map((item, i) => itemRow(item, i));

  const blocks = [
    renderObject({ account }),
    renderObject({
      form: {
        id: form.formId ?? flags.formId,
        title: form.info?.title ?? "",
        description: form.info?.description ?? "",
        revision_id: form.revisionId ?? "",
        responder_uri: form.responderUri ?? "",
        linked_sheet_id: form.linkedSheetId ?? "",
        item_count: items.length,
      },
    }),
    renderListResponse({
      name: "items",
      items: rows,
      schema: [
        field("index"),
        field("item_id"),
        field("type"),
        field("title"),
        field("description"),
      ],
      emptyMessage: "this form has no items yet (no questions, pages or content blocks)",
    }),
  ];

  const suggestions: string[] = [];
  if (form.linkedSheetId) {
    suggestions.push(
      `Read responses with: gws-axi sheets read ${form.linkedSheetId} (responses accumulate in the linked Google Sheet)`,
    );
  } else {
    suggestions.push(
      "No linked Sheet yet — open the form in the Forms UI → Responses tab → Link to Sheets, then read responses via `gws-axi sheets read`",
    );
  }
  suggestions.push(
    `Edit settings with: gws-axi forms update ${flags.formId} --title "..." --description "..." --quiz false --collect-email off`,
  );
  blocks.push(renderHelp(suggestions));

  return joinBlocks(...blocks);
}