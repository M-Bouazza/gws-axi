import { AxiError } from "axi-sdk-js";
import type { gmail_v1, people_v1 } from "googleapis";
import { gmailClient, peopleClient, translateGoogleError } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";
import { extractPhones, messageBodyText } from "../../util/phones.js";
import { PERSON_FIELDS, personRow } from "./rows.js";

export const CONTACTS_ENRICH_HELP = `usage: gws-axi contacts enrich [--limit <n>] [--apply] [flags]
flags[3]:
  --limit <n>          Max contacts missing phone to process (default: 50, max: 200)
  --apply              Commit proposed phones to saved contacts (empty fields only).
                       Without it: proposals table only — nothing is written
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts enrich                          # proposals table
  gws-axi contacts enrich --apply --limit 100      # commit phones + show company suggestions
output:
  A \`proposals[N]{id,prenom,nom,entreprise_suggestion,email,phones,source,applied}\`
  table + a \`enrich{scanned,missing_phone,proposals,applied}\` summary + a
  \`manual_company[M]\` block with ready-to-run \`update --company\` commands.
notes:
  Systematic enrichment: inventories contacts missing phone (saved + other),
  scans their Gmail signatures, extracts FR phone numbers, deduces company
  from the email domain (SUGGESTION ONLY — never auto-applied). --apply
  commits phones to saved contacts with exactly ONE phone found (ambiguous
  multi-phone cases stay manual). Company always requires a manual
  \`contacts update <id> --company <name>\` (displayed at the end). Requires
  --account <email> when 2+ accounts are authenticated.
`;

export interface ContactsEnrichFlags {
  limit: number;
  apply: boolean;
}

export function parseFlags(args: string[]): ContactsEnrichFlags {
  let limit = 50;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 50 : Math.max(1, Math.min(200, n));
        break;
      }
      case "--apply":
        apply = true;
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi contacts enrich --help\` to see available flags`,
        ]);
    }
  }
  return { limit, apply };
}

const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "protonmail.com", "proton.me",
  "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "bbox.fr", "laposte.net",
  "laposte.com", "aol.com", "live.com", "live.fr", "msn.com",
]);

/**
 * Deduce a company name from an email domain. Imperfect by design — the
 * suggestion is displayed for manual validation, never auto-applied.
 * - guillaume.humbert@interflora.fr → "Interflora"
 * - david@djuce.com → "Djuce"
 * - guillaume@matthieu-tranvan.fr → "Matthieu Tranvan"
 * - mehdi@gmail.com → "" (generic provider, no signal)
 */
export function deduceCompanyFromDomain(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain || GENERIC_DOMAINS.has(domain)) return "";
  const parts = domain.split(".");
  // Handle co.uk, com.br — take the part before the co-TLD.
  let name = parts[0] ?? "";
  if (
    parts.length >= 3 &&
    ["co", "com", "org", "net", "gov", "ac"].includes(parts[parts.length - 2] ?? "")
  ) {
    name = parts[parts.length - 3] ?? name;
  }
  if (!name || ["www", "mail", "smtp", "mx", "webmail"].includes(name)) return "";
  // Split on dashes and capitalize each segment: "matthieu-tranvan" → "Matthieu Tranvan"
  return name
    .split("-")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

interface EnrichTarget {
  id: string;
  source: "contact" | "other";
  prenom: string;
  nom: string;
  entreprise: string;
  email: string;
  etag: string;
}

async function loadAllConnections(
  account: string,
  api: people_v1.People,
): Promise<people_v1.Schema$Person[]> {
  const all: people_v1.Schema$Person[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api.people.connections.list({
      resourceName: "people/me",
      pageSize: 1000,
      ...(pageToken !== undefined ? { pageToken } : {}),
      personFields: PERSON_FIELDS,
    });
    all.push(...(res.data.connections ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken !== undefined);
  return all;
}

async function loadAllOtherContacts(
  account: string,
  api: people_v1.People,
): Promise<people_v1.Schema$Person[]> {
  const all: people_v1.Schema$Person[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api.otherContacts.list({
      pageSize: 1000,
      ...(pageToken !== undefined ? { pageToken } : {}),
      readMask: "names,emailAddresses,phoneNumbers",
    });
    all.push(...(res.data.otherContacts ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken !== undefined);
  return all;
}

interface ScanResult {
  phones: string[];
  scanned_messages: number;
}

async function scanSenderPhones(
  api: gmail_v1.Gmail,
  email: string,
): Promise<ScanResult> {
  const phones = new Set<string>();
  let scanned = 0;
  try {
    const listRes = await api.users.messages.list({
      userId: "me",
      q: `from:${email}`,
      maxResults: 3,
    });
    const ids = (listRes.data.messages ?? [])
      .map((m) => m.id ?? "")
      .filter((id) => id !== "");
    for (const id of ids) {
      try {
        const msgRes = await api.users.messages.get({ userId: "me", id, format: "full" });
        scanned++;
        const text = messageBodyText(msgRes.data.payload ?? {});
        for (const f of extractPhones(text)) {
          phones.add(f.normalized);
        }
      } catch {
        // Single-message failure — skip and continue
      }
    }
  } catch {
    // Per-sender list failure — skip this sender
  }
  return { phones: [...phones], scanned_messages: scanned };
}

export async function contactsEnrichCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await peopleClient(account);
  const gapi = await gmailClient(account);

  // 1. Load all contacts (saved + other)
  let connections: people_v1.Schema$Person[];
  let others: people_v1.Schema$Person[];
  try {
    connections = await loadAllConnections(account, api);
    others = await loadAllOtherContacts(account, api);
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "people.connections.list" });
  }

  // 2. Filter to contacts missing phone AND having at least one email
  const missingPhone: EnrichTarget[] = [];
  const seenIds = new Set<string>();
  for (const p of connections) {
    const row = personRow(p);
    if (String(row.phone) !== "" || seenIds.has(String(row.id))) continue;
    seenIds.add(String(row.id));
    const email = String(row.email).split(", ")[0] ?? "";
    if (email === "") continue;
    missingPhone.push({
      id: String(row.id),
      source: "contact",
      prenom: String(row.prenom),
      nom: String(row.nom),
      entreprise: String(row.entreprise),
      email,
      etag: p.etag ?? "",
    });
  }
  for (const p of others) {
    const row = personRow(p);
    if (String(row.phone) !== "" || seenIds.has(String(row.id))) continue;
    seenIds.add(String(row.id));
    const email = String(row.email).split(", ")[0] ?? "";
    if (email === "") continue;
    missingPhone.push({
      id: String(row.id),
      source: "other",
      prenom: String(row.prenom),
      nom: String(row.nom),
      entreprise: String(row.entreprise),
      email,
      etag: p.etag ?? "",
    });
  }

  if (missingPhone.length === 0) {
    return joinBlocks(
      renderObject({ account, missing_phone: 0 }),
      renderListResponse({
        name: "proposals",
        items: [],
        schema: [field("id")],
        emptyMessage: "every contact already has a phone — nothing to enrich",
      }),
      renderHelp(["All contacts are complete. Run periodically after new client engagements"]),
    );
  }

  // 3. Scan Gmail per sender (up to --limit targets)
  const targets = missingPhone.slice(0, flags.limit);
  const remaining = missingPhone.length - targets.length;

  interface Proposal {
    id: string;
    source: "contact" | "other";
    prenom: string;
    nom: string;
    entreprise_suggestion: string;
    email: string;
    phones: string[];
    applied: boolean;
    etag: string;
  }
  const proposals: Proposal[] = [];
  let totalScanned = 0;

  for (const target of targets) {
    const scan = await scanSenderPhones(gapi, target.email);
    totalScanned += scan.scanned_messages;
    if (scan.phones.length === 0) continue;
    proposals.push({
      id: target.id,
      source: target.source,
      prenom: target.prenom,
      nom: target.nom,
      entreprise_suggestion: target.entreprise !== "" ? target.entreprise : deduceCompanyFromDomain(target.email),
      email: target.email,
      phones: scan.phones,
      applied: false,
      etag: target.etag,
    });
  }

  if (proposals.length === 0) {
    return joinBlocks(
      renderObject({
        account,
        missing_phone: missingPhone.length,
        scanned_senders: targets.length,
        scanned_messages: totalScanned,
        proposals: 0,
      }),
      renderListResponse({
        name: "proposals",
        items: [],
        schema: [field("id")],
        emptyMessage: `no FR phone numbers found in the ${targets.length} scanned sender(s) — try a higher --limit or a broader --query`,
      }),
      renderHelp([
        `Targets scanned: ${targets.length} of ${missingPhone.length} contacts missing phone${remaining > 0 ? ` (${remaining} remaining — increase --limit)` : ""}`,
        "Re-run with a higher --limit to scan more senders",
      ]),
    );
  }

  // 4. --apply: commit phones to saved contacts with exactly 1 proposal
  let applied = 0;
  if (flags.apply) {
    for (const proposal of proposals) {
      if (proposal.source !== "contact" || proposal.phones.length !== 1) continue;
      try {
        const res = await api.people.updateContact({
          resourceName: proposal.id,
          updatePersonFields: "phoneNumbers",
          requestBody: {
            etag: proposal.etag,
            phoneNumbers: [{ value: proposal.phones[0] }],
          },
        });
        if (res.status === 200) {
          proposal.applied = true;
          applied++;
        }
      } catch {
        // Per-contact failure — skip, stay in the table as unapplied
      }
    }
  }

  // 5. Build the proposals table rows
  const tableRows = proposals.map((p) => ({
    id: p.id,
    prenom: p.prenom,
    nom: p.nom,
    entreprise_suggestion: p.entreprise_suggestion,
    email: p.email,
    phones: p.phones.join(" | "),
    source: p.source,
    applied: p.applied ? "✓" : "",
  }));

  // 6. Manual company commands (the user validated: phone auto-commits, company stays manual)
  const companyCommands = proposals
    .filter((p) => p.entreprise_suggestion !== "")
    .map((p) => {
      if (p.source === "contact") {
        return `gws-axi contacts update ${p.id} --company "${p.entreprise_suggestion}"`;
      }
      const phoneArg = p.phones.length === 1 ? ` --phone "${p.phones[0]}"` : "";
      return `gws-axi contacts add --from-other ${p.id} --company "${p.entreprise_suggestion}"${phoneArg}`;
    });

  // 7. Promotion commands for other contacts (can't update directly)
  const promotionCommands = proposals
    .filter((p) => p.source === "other")
    .map((p) => {
      const phoneArg = p.phones.length === 1 ? ` --phone "${p.phones[0]}"` : "";
      return `gws-axi contacts add --from-other ${p.id} --company "${p.entreprise_suggestion}"${phoneArg}`;
    });

  const suggestions: string[] = [];
  if (flags.apply) {
    suggestions.push(`Phones committed for ${applied} saved contact(s) (empty fields only, single-phone proposals)`);
    suggestions.push(`${proposals.filter((p) => !p.applied).length} proposal(s) NOT applied — review the table above`);
  } else {
    suggestions.push(`PROPOSALS ONLY — nothing committed. Re-run with --apply to commit the single-phone saved contacts`);
  }
  if (companyCommands.length > 0) {
    suggestions.push(`Entreprises DÉDUITES du domaine email — valider manuellement (${companyCommands.length} commande(s)) :`);
    suggestions.push(...companyCommands.slice(0, 20));
    if (companyCommands.length > 20) {
      suggestions.push(`  …et ${companyCommands.length - 20} autres`);
    }
  }
  if (remaining > 0) {
    suggestions.push(`${remaining} contacts missing phone not scanned — increase --limit (max 200)`);
  }

  return joinBlocks(
    renderObject({
      account,
      enrich: {
        missing_phone: missingPhone.length,
        scanned_senders: targets.length,
        scanned_messages: totalScanned,
        proposals: proposals.length,
        applied: flags.apply ? applied : 0,
        manual_company: companyCommands.length,
        remaining,
      },
    }),
    renderListResponse({
      name: "proposals",
      items: tableRows,
      schema: [
        field("id"),
        field("prenom"),
        field("nom"),
        field("entreprise_suggestion"),
        field("email"),
        field("phones"),
        field("source"),
        field("applied"),
      ],
      emptyMessage: "no phone numbers found — try a higher --limit",
    }),
    renderHelp(suggestions),
  );
}
