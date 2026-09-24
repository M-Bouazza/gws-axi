import type { people_v1 } from "googleapis";

/** Shared row projection for Person objects across all contacts commands. */
export function personRow(person: people_v1.Schema$Person): Record<string, unknown> {
  const name = person.names?.[0]?.displayName ?? "";
  const emails = (person.emailAddresses ?? [])
    .map((e) => e.value ?? "")
    .filter((v) => v !== "");
  const phones = (person.phoneNumbers ?? [])
    .map((p) => p.value ?? "")
    .filter((v) => v !== "");
  return {
    id: person.resourceName ?? "",
    name,
    email: emails.join(", "),
    phone: phones.join(", "),
  };
}

// People API personFields: resourceName is ALWAYS returned implicitly — it
// must NOT appear in the mask (the API rejects it with "Invalid mask path").
export const PERSON_FIELDS = "names,emailAddresses,phoneNumbers";

export const PERSON_SCHEMA_HINT = "A `contacts[N]{id,name,email,phone}` table.";
