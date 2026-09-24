import { AxiError } from "axi-sdk-js";
import type { tasks_v1 } from "googleapis";
import { tasksClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const DONE_HELP = `usage: gws-axi tasks done <taskId> [flags]
args[1]:
  <taskId>             Task id (from \`tasks list\`)
flags[2]:
  --list <id>          Task list to search first (default: iterate all lists)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi tasks done MDkyMDgzNTk0NjMzOTU0MjA6MDox
output:
  A \`task{id,title,list,done}\` block with the completion date.
notes:
  Wraps tasks.update (status = completed). When --list is omitted, all task
  lists are scanned (max 20) until the task is found — one API call per list.
  The task is completed, NOT deleted. Requires --account <email> when 2+
  accounts are authenticated.
`;

const MAX_LISTS = 20;

export interface TaskDoneFlags {
  taskId: string;
  list?: string;
}

export function parseFlags(args: string[]): TaskDoneFlags {
  let taskId: string | undefined;
  let list: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (taskId === undefined) taskId = arg;
      continue;
    }
    switch (arg) {
      case "--list":
        list = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi tasks done --help\` to see available flags`,
        ]);
    }
  }
  if (taskId === undefined) {
    throw new AxiError("Missing taskId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi tasks done <taskId> [--list <id>]",
    ]);
  }
  return { taskId, list };
}

/**
 * Resolve which list holds the task: --list when given, else scan all task
 * lists (tasks.get 404s on the wrong list, which is the signal to try the
 * next one).
 */
export async function resolveTaskList(
  account: string,
  taskId: string,
  listId: string | undefined,
): Promise<string> {
  const api = await tasksClient(account);
  if (listId !== undefined) {
    try {
      await api.tasks.get({ tasklist: listId, task: taskId });
      return listId;
    } catch (err) {
      const translated = translateGoogleError(err, { account, operation: "tasks.tasks.get" });
      if (translated.code === "NOT_FOUND") {
        throw new AxiError(
          `Task '${taskId}' not found in list '${listId}'`,
          "TASK_NOT_FOUND",
          ["Run `gws-axi tasks list <listId>` to see the current task ids"],
        );
      }
      throw translated;
    }
  }
  let lists: tasks_v1.Schema$TaskList[];
  try {
    const res = await api.tasklists.list({ maxResults: MAX_LISTS });
    lists = res.data.items ?? [];
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "tasks.tasklists.list" });
  }
  if (lists.length === 0) {
    throw new AxiError("No task list found", "TASK_LIST_NOT_FOUND", [
      "Create a list in Google Tasks UI (tasks.google.com), then re-run",
    ]);
  }
  for (const list of lists) {
    const id = list.id ?? "";
    if (id === "") continue;
    try {
      await api.tasks.get({ tasklist: id, task: taskId });
      return id;
    } catch {
      // Not in this list — try the next one.
    }
  }
  throw new AxiError(
    `Task '${taskId}' not found across ${lists.length} task list(s)`,
    "TASK_NOT_FOUND",
    [
      "Task ids come from `gws-axi tasks list` (pending) or `--show-done`",
      "Completed tasks may have been hidden — try `gws-axi tasks list --show-done`",
    ],
  );
}

export async function tasksDoneCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await tasksClient(account);
  const listId = await resolveTaskList(account, flags.taskId, flags.list);

  const completion = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let updated: { id?: string | null; title?: string | null; completed?: string | null };
  try {
    const res = await api.tasks.update({
      tasklist: listId,
      task: flags.taskId,
      requestBody: {
        id: flags.taskId,
        status: "completed",
        completed: completion,
      },
    });
    updated = res.data;
  } catch (err) {
    const translated = translateGoogleError(err, { account, operation: "tasks.tasks.update" });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Task '${flags.taskId}' not found in list '${listId}'`,
        "TASK_NOT_FOUND",
        ["Run `gws-axi tasks list` to see the current task ids"],
      );
    }
    throw translated;
  }

  const blocks = [
    renderObject({
      account,
      task: {
        id: updated.id ?? flags.taskId,
        title: updated.title ?? "",
        list: listId,
        done: updated.completed ?? completion,
      },
    }),
    renderHelp([
      "Pending tasks: gws-axi tasks list " + listId,
      "The task is completed, not deleted — restore by editing it in Google Tasks",
    ]),
  ];
  return joinBlocks(...blocks);
}