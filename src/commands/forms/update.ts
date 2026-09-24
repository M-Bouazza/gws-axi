import { AxiError } from "axi-sdk-js";
import type { forms_v1 } from "googleapis";
import { formsClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const UPDATE_HELP = `usage: gws-axi forms update <formId> [flags]
args[1]:
  <formId>                     The Google Form ID (from the URL after /d/e/)
flags[4]:
  --title <text>               New responder-visible title
  --description <text>         New form description ('' clears it)
  --quiz <true|false>          Turn quiz mode on/off (off deletes question
                               grading — the API does this permanently)
  --collect-email <mode>       off | optional | verified
examples:
  gws-axi forms update 1AbC... --title "Diagnostic process - Client X"
  gws-axi forms update 1AbC... --quiz true --collect-email verified
output:
  A \`form{id,title,revision_id}\` header plus an \`updated{requests,info_mask,
  settings_mask}\` block reporting what the API changed.
notes:
  Wraps forms.batchUpdate (updateFormInfo + updateSettings). Unlike
  Docs/Slides there is NO text search-and-replace on a Form — the API mutates
  structured items, so this command edits form-level settings only. Questions
  are edited in the Forms UI for now. Requires --account <email> when 2+
  accounts are authenticated, and the forms scope (re-consent via
  \`gws-axi auth login\` if it was granted before forms was added).
`;

export interface FormsUpdateFlags {
  formId: string;
  title?: string;
  description?: string;
  quiz?: boolean;
  collectEmail?: "off" | "optional" | "verified";
}

const EMAIL_ENUM: Record<string, forms_v1.Schema$FormSettings["emailCollectionType"]> = {
  off: "DO_NOT_COLLECT",
  none: "DO_NOT_COLLECT",
  optional: "RESPONDER_INPUT",
  verified: "VERIFIED",
  do_not_collect: "DO_NOT_COLLECT",
  responder_input: "RESPONDER_INPUT",
};

export function parseQuiz(raw: string): boolean {
  const norm = raw.trim().toLowerCase();
  if (norm === "true" || norm === "yes") return true;
  if (norm === "false" || norm === "no") return false;
  throw new AxiError(`--quiz expects true or false (got '${raw}')`, "VALIDATION_ERROR", [
    "Quiz mode is a boolean — e.g. --quiz true turns the form into a quiz",
    "Turning it OFF permanently deletes all question grading",
  ]);
}

export interface FormsUpdateParsed {
  formId: string;
  title?: string;
  description?: string;
  quiz?: boolean;
  collectEmail?: forms_v1.Schema$FormSettings["emailCollectionType"];
}

export function parseFlags(args: string[]): FormsUpdateParsed {
  let formId: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let quiz: boolean | undefined;
  let collectRaw: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (formId === undefined) formId = arg;
      continue;
    }
    switch (arg) {
      case "--title":
        title = args[++i];
        break;
      case "--description":
        description = args[++i];
        break;
      case "--quiz":
        quiz = parseQuiz(args[++i]);
        break;
      case "--collect-email":
        collectRaw = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi forms update --help\` to see available flags`,
        ]);
    }
  }
  if (formId === undefined) {
    throw new AxiError("Missing formId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi forms update <formId> --title <text>",
    ]);
  }
  if (title === undefined && description === undefined && quiz === undefined && !collectRaw) {
    throw new AxiError(
      "Nothing to update — pass at least one of --title, --description, --quiz, --collect-email",
      "VALIDATION_ERROR",
      ["Example: gws-axi forms update 1AbC... --title \"Diagnostic\" --quiz false"],
    );
  }
  const collectEmail = collectRaw === undefined ? undefined : requireCollectEmail(collectRaw);
  return { formId, title, description, quiz, collectEmail };
}

function requireCollectEmail(
  raw: string,
): forms_v1.Schema$FormSettings["emailCollectionType"] {
  const key = raw.trim().toLowerCase().replace(/-+/g, "_");
  const mapped = EMAIL_ENUM[key];
  if (!mapped) {
    throw new AxiError(
      `--collect-email must be one of off, optional, verified (got '${raw}')`,
      "VALIDATION_ERROR",
      ["off = DO_NOT_COLLECT, optional = RESPONDER_INPUT, verified = VERIFIED"],
    );
  }
  return mapped;
}

export async function formsUpdateCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await formsClient(account);

  // Preflight get so the report names the form and the 404 path distinguishes
  // a wrong id from an access problem.
  let currentTitle: string;
  try {
    const res = await api.forms.get({
      formId: flags.formId,
      fields: "info.title",
    });
    currentTitle = res.data.info?.title ?? flags.formId;
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

  const requests: forms_v1.Schema$Request[] = [];
  const infoMask: string[] = [];
  const settingsMask: string[] = [];

  if (flags.title !== undefined || flags.description !== undefined) {
    if (flags.title !== undefined) infoMask.push("title");
    if (flags.description !== undefined) infoMask.push("description");
    requests.push({
      updateFormInfo: {
        info: {
          ...(flags.title !== undefined ? { title: flags.title } : {}),
          ...(flags.description !== undefined ? { description: flags.description } : {}),
        },
        updateMask: infoMask.join(","),
      },
    });
  }
  if (flags.quiz !== undefined || flags.collectEmail !== undefined) {
    if (flags.quiz !== undefined) settingsMask.push("quizSettings.isQuiz");
    if (flags.collectEmail !== undefined) settingsMask.push("emailCollectionType");
    requests.push({
      updateSettings: {
        settings: {
          ...(flags.quiz !== undefined ? { quizSettings: { isQuiz: flags.quiz } } : {}),
          ...(flags.collectEmail !== undefined ? { emailCollectionType: flags.collectEmail } : {}),
        },
        updateMask: settingsMask.join(","),
      },
    });
  }

  let updated: forms_v1.Schema$Form | undefined;
  try {
    const res = await api.forms.batchUpdate({
      formId: flags.formId,
      requestBody: {
        requests,
        includeFormInResponse: true,
      },
    });
    updated = res.data.form ?? undefined;
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "forms.forms.batchUpdate" });
  }

  const blocks = [
    renderObject({
      account,
      form: {
        id: flags.formId,
        title: updated?.info?.title ?? currentTitle,
        revision_id: updated?.revisionId ?? "",
      },
      updated: {
        requests: requests.length,
        info_mask: infoMask.join(",") || "",
        settings_mask: settingsMask.join(",") || "",
        ...(flags.quiz !== undefined ? { quiz: flags.quiz } : {}),
        ...(flags.collectEmail !== undefined ? { collect_email: flags.collectEmail } : {}),
      },
    }),
    renderHelp([
      `Verify with: gws-axi forms get ${flags.formId}`,
      "Form responses live in the linked Google Sheet — read them with `gws-axi sheets read <linked-sheet-id>`",
      ...(flags.quiz === false
        ? ["Quiz mode turned OFF — the API permanently deleted all question grading"]
        : []),
    ]),
  ];
  return joinBlocks(...blocks);
}