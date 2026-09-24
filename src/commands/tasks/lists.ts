import type { tasks_v1 } from "googleapis";
import { tasksClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";

export const LISTS_HELP = `usage: gws-axi tasks lists [flags]
flags[1]:
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi tasks lists
output:
  A \`lists[N]{id,title}\` table — one row per task list. Use the \`id\` for
  \`tasks list <id>\` / \`tasks add --list <id>\`; omit --list there and the
  first list is the default target.
notes:
  Task lists are ordered by position; the first one is gws-axi's default.
`;

export async function tasksListsCommand(account: string, _args: string[]): Promise<string> {
  const api = await tasksClient(account);
  let lists: tasks_v1.Schema$TaskList[];
  try {
    const res = await api.tasklists.list({ maxResults: 100 });
    lists = res.data.items ?? [];
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "tasks.tasklists.list" });
  }

  const rows = lists.map((l) => ({
    id: l.id ?? "",
    title: l.title ?? "",
  }));

  const blocks = [
    renderObject({ account }),
    renderListResponse({
      name: "lists",
      items: rows,
      schema: [field("id"), field("title")],
      emptyMessage: "no task lists — create one in Google Tasks UI, then re-run",
    }),
    renderHelp([
      "Default target is the first list: `gws-axi tasks add \"...\"` writes there unless --list <id> is passed",
    ]),
  ];
  return joinBlocks(...blocks);
}