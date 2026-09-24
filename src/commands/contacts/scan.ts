import { AxiError } from "axi-sdk-js";
import type { gmail_v1 } from "googleapis";
import { gmailClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";
import { extractPhones, messageBodyText } from "../../util/phones.js";

export const CONTACTS_SCAN_HELP = `usage: gws-axi contacts scan-signatures [flags]
flags[3]:
  --query <gmail>      Gmail search query to scope the scan
                       (default: 'newer_than:1y' — prefer tighter scopes like
                       'from:david@djuce.com' or 'label:clients')
  --limit <n>          Max messages to scan (default: 50, max: 200)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts scan-signatures --query "from:david@djuce.com"
  gws-axi contacts scan-signatures --query "label:mb-clients" --limit 100
output:
  A \`candidates[N]{email,name,phones,from_message}\` table — senders whose
  message bodies contain FR phone numbers, with the numbers found.
notes:
  PROPOSAL ONLY — nothing is created; review the candidates, then commit
  with \`contacts add\` / \`contacts update\`. Signatures are free text:
  expect some false positives (SIRET fragments or dates can slip in) — the
  table shows the source message id for spot-checking. Reads count against
  Gmail quota (1 unit per message). Requires --account <email> when 2+
  accounts are authenticated.
`;

export interface ContactsScanFlags {
  query: string;
  limit: number;
}

export function parseFlags(args: string[]): ContactsScanFlags {
  let query = "newer_than:1y";
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--query":
        query = args[++i];
        break;
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 50 : Math.max(1, Math.min(200, n));
        break;
      }
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi contacts scan-signatures --help\` to see available flags`,
        ]);
    }
  }
  return { query, limit };
}

/** Parse a From header into name + email (bare email → name ""). */
export function fromHeader(value: string): { email: string; name: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  return { name: "", email: trimmed };
}

export async function contactsScanCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await gmailClient(account);

  let messageIds: string[];
  try {
    const res = await api.users.messages.list({
      userId: "me",
      q: flags.query,
      maxResults: flags.limit,
    });
    messageIds = (res.data.messages ?? [])
      .map((m) => m.id ?? "")
      .filter((id) => id !== "");
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "gmail.users.messages.list" });
  }

  if (messageIds.length === 0) {
    return joinBlocks(
      renderObject({ account, query: flags.query, scanned: 0 }),
      renderListResponse({
        name: "candidates",
        items: [],
        schema: [field("email")],
        emptyMessage: `no messages matched "${flags.query}" — nothing to scan`,
      }),
      renderHelp(["Widen the scope, e.g. --query \"newer_than:2y\" or a higher --limit"]),
    );
  }

  // Group found phones by sender email; keep the first message id as source.
  const candidates = new Map<
    string,
    { email: string; name: string; phones: string[]; from_message: string }
  >();
  for (const id of messageIds) {
    let message: gmail_v1.Schema$Message;
    try {
      const res = await api.users.messages.get({ userId: "me", id, format: "full" });
      message = res.data;
    } catch (err) {
      throw translateGoogleError(err, { account, operation: "gmail.messages.get" });
    }
    const from = (message.payload?.headers ?? []).find(
      (h) => h.name?.toLowerCase() === "from",
    );
    const sender = fromHeader(from?.value ?? "");
    if (sender.email === "") continue;
    const text = messageBodyText(message.payload ?? {});
    const found = extractPhones(text);
    if (found.length === 0) continue;
    const entry = candidates.get(sender.email);
    if (entry) {
      for (const f of found) {
        if (!entry.phones.includes(f.normalized)) entry.phones.push(f.normalized);
      }
    } else {
      candidates.set(sender.email, {
        email: sender.email,
        name: sender.name,
        phones: found.map((f) => f.normalized),
        from_message: id,
      });
    }
  }

  const rows = [...candidates.values()].map((c) => ({
    email: c.email,
    name: c.name,
    phones: c.phones.join(" | "),
    from_message: c.from_message,
  }));

  const suggestions = [
    "PROPOSAL ONLY — nothing was created. Spot-check with the from_message ids, then commit:",
    'Save new: gws-axi contacts add --name "<name>" --company "<company>" --email <email> --phone "<phone>"',
    "Enrich existing: gws-axi contacts update <contactId> --phone \"<phone>\" --company \"<name>\"",
    "Check a sender: gws-axi contacts search <email> --include-other",
  ];

  return joinBlocks(
    renderObject({ account, query: flags.query, scanned: messageIds.length }),
    renderListResponse({
      name: "candidates",
      items: rows,
      schema: [field("email"), field("name"), field("phones"), field("from_message")],
      emptyMessage:
        "no FR phone numbers found in the scanned message bodies — try a wider --query or --limit",
    }),
    renderHelp(suggestions),
  );
}
