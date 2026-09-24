import { AxiError } from "axi-sdk-js";
import type { tasks_v1 } from "googleapis";
import { tasksClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
  type FieldDef,
} from "../../output/index.js";

export const TASK_LIST_HELP = `usage: gws-axi tasks list [<listId>] [flags]
args[1]:
  <listId>             Optional task list id (from \`tasks lists\`); default:
                       the first list
flags[3]:
  --show-done          Include completed tasks (hidden by default)
  --limit <n>          Max tasks to return (default: 50, max: 200)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi tasks list
  gws-axi tasks list MDkyMDgzNTk0 --show-done --limit 100
output:
  A \`tasks[N]{id,title,due,notes,done}\` table. \`done\` holds the completion
  date when the task is completed.
notes:
  Completed tasks are hidden unless --show-done. Task ids feed
  \`tasks done <id>\`.
`;

export interface TaskListFlags {
  listId?: string;
  showDone: boolean;
  limit: number;
}

export function parseFlags(args: string[]): TaskListFlags {
  let listId: string | undefined;
  let showDone = false;
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (listId === undefined) listId = arg;
      continue;
    }
    switch (arg) {
      case "--show-done":
        showDone = true;
        break;
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 50 : Math.max(1, Math.min(200, n));
        break;
      }
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi tasks list --help\` to see available flags`,
        ]);
    }
  }
  return { listId, showDone, limit };
}

export async function tasksListCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await tasksClient(account);

  const listId = flags.listId ?? (await defaultListId(account));
  let tasks: tasks_v1.Schema$Task[];
  try {
    const res = await api.tasks.list({
      tasklist: listId,
      maxResults: flags.limit,
      showCompleted: flags.showDone,
      showHidden: false,
    });
    tasks = res.data.items ?? [];
  } catch (err) {
    const translated = translateGoogleError(err, { account, operation: "tasks.tasks.list" });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Task list '${listId}' not found (or ${account} doesn't have access)`,
        "TASK_LIST_NOT_FOUND",
        [
          "Run `gws-axi tasks lists` to see available list ids",
          "Omit the listId to target the first list",
        ],
      );
    }
    throw translated;
  }

  const rows = tasks.map((t) => ({
    id: t.id ?? "",
    title: t.title ?? "",
    due: t.due ?? "",
    notes: (t.notes ?? "").slice(0, 120),
    done: t.completed ?? "",
  }));

  const schema: FieldDef[] = [
    field("id"),
    field("title"),
    field("due"),
    field("notes"),
    field("done"),
  ];

  const suggestions: string[] = [
    "Complete a task: gws-axi tasks done <id>",
    "Add a task: gws-axi tasks add \"<title>\" [--due YYYY-MM-DD] [--notes <text>]",
  ];

  return joinBlocks(
    renderObject({ account, list: listId ?? "" }),
    renderListResponse({
      name: "tasks",
      items: rows,
      schema,
      emptyMessage: flags.showDone
        ? "no tasks in this list"
        : "no pending tasks in this list (use --show-done to include completed)",
    }),
    renderHelp(suggestions),
  );
}

/** Resolve the default task list id (the first list) when none was passed. */
export async function defaultListId(account: string): Promise<string> {
  const api = await tasksClient(account);
  try {
    const res = await api.tasklists.list({ maxResults: 1 });
    const first = (res.data.items ?? [])[0];
    if (!first?.id) {
      throw new AxiError("No task list found", "TASK_LIST_NOT_FOUND", [
        "Create a list in Google Tasks UI (tasks.google.com), then re-run",
      ]);
    }
    return first.id ?? "";
  } catch (err) {
    if (err instanceof AxiError) throw err;
    throw translateGoogleError(err, { account, operation: "tasks.tasklists.list" });
  }
}