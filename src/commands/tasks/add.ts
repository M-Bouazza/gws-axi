import { AxiError } from "axi-sdk-js";
import { tasksClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";
import { defaultListId } from "./list.js";

export const ADD_HELP = `usage: gws-axi tasks add <title> [flags]
args[1]:
  <title>              Task title (quote multi-word titles)
flags[4]:
  --due <date>         YYYY-MM-DD or full RFC3339; the task becomes due that day
  --notes <text>       Free-text notes on the task
  --list <id>          Target task list (default: the first list)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi tasks add "Relancer le devis MTV"
  gws-axi tasks add "Call kickoff Djuce" --due 2026-09-28 --notes "14h-16h"
output:
  A \`task{id,title,list,due,notes}\` block reporting what was created.
notes:
  Wraps tasks.insert. Use \`gws-axi tasks lists\` to pick a target list;
  the first list is the default. Requires --account <email> when 2+
  accounts are authenticated.
`;

export interface TaskAddFlags {
  title: string;
  notes?: string;
  due?: string;
  list?: string;
}

/** Normalize a --due value: YYYY-MM-DD → end-of-day RFC3339; RFC3339 passes through. */
export function normalizeDue(due: string): string {
  const trimmed = due.trim();
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    // JS Date silently rolls 2026-13-40 into a valid date — validate the
    // calendar fields instead of trusting the constructor.
    const [, y, m, d] = dateOnly;
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    const rolled =
      parsed.getUTCFullYear() !== Number(y) ||
      parsed.getUTCMonth() + 1 !== Number(m) ||
      parsed.getUTCDate() !== Number(d);
    if (rolled || Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) {
      throw new AxiError(
        `--due must be a real calendar date (got '${due}')`,
        "VALIDATION_ERROR",
        ["Example: --due 2026-09-28 or --due 2026-09-28T14:00:00Z"],
      );
    }
    return `${trimmed}T23:59:59.000Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new AxiError(
      `--due must be YYYY-MM-DD or an RFC3339 date (got '${due}')`,
      "VALIDATION_ERROR",
      ["Example: --due 2026-09-28 or --due 2026-09-28T14:00:00Z"],
    );
  }
  return parsed.toISOString();
}

export function parseFlags(args: string[]): TaskAddFlags {
  let title: string | undefined;
  let notes: string | undefined;
  let due: string | undefined;
  let list: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (title === undefined) title = arg;
      continue;
    }
    switch (arg) {
      case "--notes":
        notes = args[++i];
        break;
      case "--due":
        due = args[++i];
        break;
      case "--list":
        list = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi tasks add --help\` to see available flags`,
        ]);
    }
  }
  if (title === undefined) {
    throw new AxiError("Missing task title", "VALIDATION_ERROR", [
      'Usage: gws-axi tasks add "<title>" [--due YYYY-MM-DD] [--notes <text>]',
    ]);
  }
  return {
    title,
    notes,
    ...(due !== undefined ? { due: normalizeDue(due) } : {}),
    list,
  };
}

export async function tasksAddCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await tasksClient(account);
  const listId = flags.list ?? (await defaultListId(account));

  let created: { id?: string | null; title?: string | null; due?: string | null };
  try {
    const res = await api.tasks.insert({
      tasklist: listId,
      requestBody: {
        title: flags.title,
        ...(flags.notes !== undefined ? { notes: flags.notes } : {}),
        ...(flags.due !== undefined ? { due: flags.due } : {}),
      },
    });
    created = res.data;
  } catch (err) {
    const translated = translateGoogleError(err, { account, operation: "tasks.tasks.insert" });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Task list '${listId}' not found (or ${account} doesn't have access)`,
        "TASK_LIST_NOT_FOUND",
        ["Run `gws-axi tasks lists` to see available list ids"],
      );
    }
    throw translated;
  }

  const blocks = [
    renderObject({
      account,
      task: {
        id: created.id ?? "",
        title: created.title ?? flags.title,
        list: listId,
        due: created.due ?? "",
        notes: flags.notes ?? "",
      },
    }),
    renderHelp([
      "Complete later with: gws-axi tasks done " + (created.id ?? "<id>"),
      "Review pending tasks with: gws-axi tasks list " + listId,
    ]),
  ];
  return joinBlocks(...blocks);
}