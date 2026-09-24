import { AxiError } from "axi-sdk-js";
import { peopleClient, translateGoogleError } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const CONTACTS_ADD_HELP = `usage: gws-axi contacts add [--name <text>] [--email <addr>] [--phone <num>] [--from-other <id>] [flags]
flags[5]:
  --name <text>        Full name ("Given Family"); ignored with --from-other
  --email <addr>       Email address
  --phone <num>        Phone number (any format, stored as given)
  --from-other <id>    Promote an Other Contact (from \`contacts other\`) to
                       a saved contact; --phone/--email enrich it
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi contacts add --name "David Dworsky" --email david@djuce.com --phone "+33 6 12 34 56 78"
  gws-axi contacts add --from-other otherContacts/c123456 --phone "06 12 34 56 78"
output:
  A \`contact{id,name,email,phone,source}\` block reporting what was created.
notes:
  Wraps people.createContact — or copyOtherContactToMyContactsGroup with
  --from-other (the promotion preserves what Google already knows, the
  flags fill the gaps). Requires --account <email> when 2+ accounts are
  authenticated.
`;

export interface ContactsAddFlags {
  name?: string;
  email?: string;
  phone?: string;
  fromOther?: string;
}

export function parseFlags(args: string[]): ContactsAddFlags {
  let name: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  let fromOther: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
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
      case "--from-other":
        fromOther = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi contacts add --help\` to see available flags`,
        ]);
    }
  }
  if (fromOther === undefined && name === undefined && email === undefined && phone === undefined) {
    throw new AxiError(
      "Nothing to add — pass --from-other <id> or at least --name / --email",
      "VALIDATION_ERROR",
      [
        'Example: contacts add --name "David Dworsky" --email david@djuce.com',
        "Example: contacts add --from-other otherContacts/c123 --phone '06 12 34 56 78'",
      ],
    );
  }
  if (fromOther !== undefined && name !== undefined) {
    throw new AxiError("--name cannot be combined with --from-other", "VALIDATION_ERROR", [
      "The promotion keeps the name Google already knows; use --phone/--email to enrich",
      "Set the name later: contacts update <new-id> --name \"...\"",
    ]);
  }
  return { name, email, phone, fromOther };
}

/** Split a full name into given/family on the last space ("David van Dyk"). */
export function splitName(fullName: string): { givenName: string; familyName: string } {
  const trimmed = fullName.trim().replace(/\s+/g, " ");
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) {
    return { givenName: trimmed, familyName: "" };
  }
  return {
    givenName: trimmed.slice(0, lastSpace),
    familyName: trimmed.slice(lastSpace + 1),
  };
}

export async function contactsAddCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await peopleClient(account);

  let created: {
    resourceName?: string | null;
    names?: Array<{ displayName?: string | null }> | null;
    emailAddresses?: Array<{ value?: string | null }> | null;
    phoneNumbers?: Array<{ value?: string | null }> | null;
    etag?: string | null;
  };
  try {
    if (flags.fromOther !== undefined) {
      const res = await api.otherContacts.copyOtherContactToMyContactsGroup({
        resourceName: flags.fromOther,
        requestBody: {
          // Copy what Google knows; the enriching phone (when passed) is
          // appended via a follow-up updateContact (the copy request can't
          // add new fields, only copy existing ones). The etag from the copy
          // response is required on the update — People API rejects writes
          // without it ("Request must set person.etag...").
          copyMask: "names,emailAddresses,phoneNumbers",
        },
      });
      created = res.data;
      if (flags.phone !== undefined && created.resourceName) {
        const phoneRes = await api.people.updateContact({
          resourceName: created.resourceName,
          updatePersonFields: "phoneNumbers",
          requestBody: {
            etag: created.etag ?? "",
            phoneNumbers: [{ value: flags.phone }],
          },
        });
        created.phoneNumbers = phoneRes.data.phoneNumbers ?? null;
      }
    } else {
      const body: Record<string, unknown> = {};
      if (flags.name !== undefined) {
        const { givenName, familyName } = splitName(flags.name);
        body.names = [{ givenName, familyName }];
      }
      if (flags.email !== undefined) body.emailAddresses = [{ value: flags.email }];
      if (flags.phone !== undefined) body.phoneNumbers = [{ value: flags.phone }];
      const res = await api.people.createContact({ requestBody: body });
      created = res.data;
    }
  } catch (err) {
    const translated = translateGoogleError(err, { account, operation: "people.createContact" });
    if (translated.code === "NOT_FOUND") {
      throw new AxiError(
        `Other contact '${flags.fromOther}' not found (or ${account} lacks access)`,
        "CONTACT_NOT_FOUND",
        [
          "Get valid other-contact ids from: gws-axi contacts other",
          "Or create from scratch with --name / --email / --phone",
        ],
      );
    }
    throw translated;
  }

  const blocks = [
    renderObject({
      account,
      contact: {
        id: created.resourceName ?? "",
        name: created.names?.[0]?.displayName ?? flags.name ?? "",
        email: created.emailAddresses?.[0]?.value ?? flags.email ?? "",
        phone: created.phoneNumbers?.[0]?.value ?? flags.phone ?? "",
        source: flags.fromOther !== undefined ? "promoted-from-other" : "created",
      },
    }),
    renderHelp([
      "Verify with: gws-axi contacts list",
      "Add missing details later: gws-axi contacts update " + (created.resourceName ?? "<id>") + " --phone <num>",
    ]),
  ];
  return joinBlocks(...blocks);
}
