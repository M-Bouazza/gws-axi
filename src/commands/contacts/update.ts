import { AxiError } from "axi-sdk-js";
import { peopleClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const CONTACTS_UPDATE_HELP = `usage: gws-axi contacts update <contactId> [--name <text>] [--email <addr>] [--phone <num>] [flags]
args[1]:
  <contactId>          Saved contact id (people/c...) from \`contacts list\`
flags[4]:
  --name <text>        New full name (replaces the primary name)
  --email <addr>       Email: replaces the first entry when one exists, else adds
  --phone <num>        Phone: replaces the first entry when one exists, else adds
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts update people/c123456 --phone "06 12 34 56 78"
  gws-axi contacts update people/c123456 --name "David Dworsky" --email david@djuce.com
output:
  A \`contact{id,name,email,phone,updated_masks}\` block reporting what changed.
notes:
  Wraps people.updateContact. The contact is fetched first and the provided
  fields are merged INTO what exists (first entry replaced, others kept) —
  no blind overwrite. Requires --account <email> when 2+ accounts are
  authenticated.
`;

export interface ContactsUpdateFlags {
  contactId: string;
  name?: string;
  email?: string;
  phone?: string;
}

export function parseFlags(args: string[]): ContactsUpdateFlags {
  let contactId: string | undefined;
  let name: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (contactId === undefined) contactId = arg;
      continue;
    }
    switch (arg) {
      case "--name":
        name = args[++i];
        break;
      case "--email":
        email = args[++i];
        break;
      case "--phone":
        phone = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi contacts update --help\` to see available flags`,
        ]);
    }
  }
  if (contactId === undefined) {
    throw new AxiError("Missing contactId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi contacts update <contactId> --phone <num>",
    ]);
  }
  if (name === undefined && email === undefined && phone === undefined) {
    throw new AxiError(
      "Nothing to update — pass at least one of --name, --email, --phone",
      "VALIDATION_ERROR",
      ['Example: contacts update people/c123 --phone "06 12 34 56 78"'],
    );
  }
  return { contactId, name, email, phone };
}

/** Replace the first entry's value in an array-of-{value}, or append. */
export function mergeValueArray(
  existing: Array<{ value?: string | null }> | null | undefined,
  newValue: string,
): Array<{ value: string }> {
  const merged = (existing ?? []).map((entry) => ({ value: entry.value ?? "" }));
  if (merged.length > 0 && merged[0].value !== "") {
    merged[0] = { value: newValue };
  } else {
    merged.unshift({ value: newValue });
  }
  return merged;
}

export async function contactsUpdateCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await peopleClient(account);

  let existing: {
    etag?: string | null;
    names?: Array<{ givenName?: string | null; familyName?: string | null; displayName?: string | null }> | null;
    emailAddresses?: Array<{ value?: string | null }> | null;
    phoneNumbers?: Array<{ value?: string | null }> | null;
  };
  try {
    const res = await api.people.get({
      resourceName: flags.contactId,
      personFields: "names,emailAddresses,phoneNumbers",
    });
    existing = res.data;
  } catch (err) {
    const translated = translateGoogleError(err, { account, operation: "people.get" });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Contact '${flags.contactId}' not found (or ${account} doesn't have access)`,
        "CONTACT_NOT_FOUND",
        [
          "Get valid contact ids from: gws-axi contacts list",
          "Other Contacts (unsaved) are read-only: promote with `contacts add --from-other`",
        ],
      );
    }
    throw translated;
  }

  const requestBody: Record<string, unknown> = {
    // People API requires the etag of the entity being modified — fetched
    // from the people.get above. Without it: 400 "must set person.etag".
    etag: existing.etag ?? "",
  };
  const masks: string[] = [];
  if (flags.name !== undefined) {
    const [given = "", ...rest] = flags.name.trim().replace(/\s+/g, " ").split(" ");
    requestBody.names = [{ givenName: given, familyName: rest.join(" ") }];
    masks.push("names");
  }
  if (flags.email !== undefined) {
    requestBody.emailAddresses = mergeValueArray(existing.emailAddresses, flags.email);
    masks.push("emailAddresses");
  }
  if (flags.phone !== undefined) {
    requestBody.phoneNumbers = mergeValueArray(existing.phoneNumbers, flags.phone);
    masks.push("phoneNumbers");
  }

  let updated: {
    names?: Array<{ displayName?: string | null }> | null;
    emailAddresses?: Array<{ value?: string | null }> | null;
    phoneNumbers?: Array<{ value?: string | null }> | null;
  };
  try {
    const res = await api.people.updateContact({
      resourceName: flags.contactId,
      updatePersonFields: masks.join(","),
      requestBody,
    });
    updated = res.data;
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "people.updateContact" });
  }

  const blocks = [
    renderObject({
      account,
      contact: {
        id: flags.contactId,
        name: updated.names?.[0]?.displayName ?? "",
        email: (updated.emailAddresses ?? []).map((e) => e.value ?? "").join(", "),
        phone: (updated.phoneNumbers ?? []).map((p) => p.value ?? "").join(", "),
        updated_masks: masks.join(","),
      },
    }),
    renderHelp([
      "Verify with: gws-axi contacts search " + (updated.names?.[0]?.displayName ?? flags.contactId),
      "Merge semantics: the first matching entry is replaced, other entries are kept",
    ]),
  ];
  return joinBlocks(...blocks);
}
