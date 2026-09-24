import { resolveAccount, withAccountSource } from "../google/account.js";
import { mergeRunCommand, MERGE_RUN_HELP } from "./merge/run.js";

export const MERGE_HELP = `${MERGE_RUN_HELP.trimEnd()}

subcommands: none — merge is a single templating command. It composes three
shipped surfaces: drive files.copy (template safety), sheets values.get
(series data), and docs/slides batchUpdate replaceAllText (the replacements).
`;

export async function mergeCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return MERGE_HELP;
  }

  // Single-command service: no subcommand layer, --account inline like the
  // per-service dispatchers strip it.
  const rest: string[] = [];
  let accountFlag: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--account" && args[i + 1]) {
      accountFlag = args[i + 1];
      i++;
      continue;
    }
    rest.push(arg);
  }
  if (rest.includes("--help")) {
    return MERGE_HELP;
  }

  const resolution = resolveAccount(accountFlag, {
    mutation: true,
    commandName: "merge",
  });

  return withAccountSource(resolution, await mergeRunCommand(resolution.account, rest));
}