import { AxiError } from "axi-sdk-js";
import { resolveAccount, withAccountSource } from "../google/account.js";
import { notImplemented, renderAlternatives, withInstead } from "./stub-signposts.js";
import { tasksAddCommand, ADD_HELP } from "./tasks/add.js";
import { DONE_HELP, tasksDoneCommand } from "./tasks/done.js";
import { TASK_LIST_HELP, tasksListCommand } from "./tasks/list.js";
import { LISTS_HELP, tasksListsCommand } from "./tasks/lists.js";

interface TasksSubcommand {
  name: string;
  mutation: boolean;
  help: string;
  handler?: (account: string, args: string[]) => Promise<string>;
  instead?: string[];
}

const DELETE_HELP = `usage: gws-axi tasks delete <taskId> [flags]
status: planned — not yet implemented
notes:
  Will wrap tasks.delete (destructive — Google Tasks hides completed tasks
  well enough; \`tasks done\` is usually the right move).
`;
const MOVE_HELP = `usage: gws-axi tasks move <taskId> --list <id> [flags]
status: planned — not yet implemented
`;
const CLEAR_HELP = `usage: gws-axi tasks clear <listId> [flags]
status: planned — not yet implemented
`;

const TASKS_DELETE_SIGNPOST = [
  "gws-axi tasks done <taskId> — completing usually covers it (Google Tasks hides completed tasks)",
];

const SUBCOMMANDS: TasksSubcommand[] = [
  { name: "lists", mutation: false, help: LISTS_HELP, handler: tasksListsCommand },
  { name: "list", mutation: false, help: TASK_LIST_HELP, handler: tasksListCommand },
  { name: "add", mutation: true, help: ADD_HELP, handler: tasksAddCommand },
  { name: "done", mutation: true, help: DONE_HELP, handler: tasksDoneCommand },
  { name: "delete", mutation: true, help: DELETE_HELP, instead: TASKS_DELETE_SIGNPOST },
  { name: "move", mutation: true, help: MOVE_HELP },
  { name: "clear", mutation: true, help: CLEAR_HELP },
];

const SUB_BY_NAME: Record<string, TasksSubcommand> = Object.fromEntries(
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

export const TASKS_HELP = `usage: gws-axi tasks <subcommand> [args] [--account <email>] [flags]
reads[${reads.length}]:
  ${reads.join(", ")}
writes[${writes.length}]:
  ${writes.join(", ")}
notes:
  Writes require --account <email> when 2+ accounts are authenticated.
  Reads use the default account when --account is not provided.
  'add' and 'done' are implemented; delete/move/clear are scaffolded.
  The default task list is the first one (\`tasks lists\` shows the order).
${renderAlternatives(SUBCOMMANDS)}subcommand help:
  gws-axi tasks lists --help  for task list enumeration
  gws-axi tasks list --help   for reading tasks (pending by default)
  gws-axi tasks add --help    for creating tasks
  gws-axi tasks done --help   for completing tasks
examples:
  gws-axi tasks lists
  gws-axi tasks list --show-done
  gws-axi tasks add "Relancer le devis MTV" --due 2026-09-28
  gws-axi tasks done MDkyMDgzNTk0NjMzOTU0MjA6MDox
`;

export async function tasksCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return TASKS_HELP;
  }

  const sub = args[0];
  const def = SUB_BY_NAME[sub];
  if (!def) {
    throw new AxiError(`Unknown tasks subcommand: ${sub}`, "VALIDATION_ERROR", [
      `Run \`gws-axi tasks --help\` to see available subcommands`,
    ]);
  }

  const rest = args.slice(1);
  if (rest.includes("--help")) {
    return def.handler ? def.help : withInstead(def.help, def.instead);
  }

  const { account: accountFlag, rest: remaining } = parseAccountFlag(rest);
  const resolution = resolveAccount(accountFlag, {
    mutation: def.mutation,
    commandName: `tasks ${sub}`,
  });

  if (!def.handler) {
    throw notImplemented("tasks", sub, resolution.account, def.instead);
  }

  return withAccountSource(resolution, await def.handler(resolution.account, remaining));
}