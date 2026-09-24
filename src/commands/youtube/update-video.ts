import { AxiError } from "axi-sdk-js";
import { translateGoogleError, youtubeClient } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const YT_UPDATE_HELP = `usage: gws-axi youtube update-video <videoId> [flags]
args[1]:
  <videoId>            Video id (from \`youtube videos\` or the URL)
flags[5]:
  --title <text>       New video title
  --description <text> New description ('' clears it)
  --tags <t1,t2>       Comma-separated tags (replaces the full tag set)
  --privacy <status>   private | unlisted | public
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi youtube update-video dQw4w9WgXcQ --title "Nouveau titre"
  gws-axi youtube update-video dQw4w9WgXcQ --privacy unlisted
output:
  A \`video{id,title,privacy,updated_masks}\` block reporting what changed.
notes:
  Wraps videos.update (50 quota units). Only the masks you pass are updated;
  the current snippet is fetched first so unspecified fields (title,
  description, categoryId — the API requires categoryId on snippet writes)
  are preserved. Requires --account <email> when 2+ accounts are
  authenticated.
`;

export interface YtUpdateFlags {
  videoId: string;
  title?: string;
  description?: string;
  tags?: string[];
  privacy?: "private" | "unlisted" | "public";
}

const PRIVACY_VALUES = ["private", "unlisted", "public"] as const;

export function parsePrivacy(raw: string): "private" | "unlisted" | "public" {
  const norm = raw.trim().toLowerCase();
  const found = PRIVACY_VALUES.find((v) => v === norm);
  if (!found) {
    throw new AxiError(
      `--privacy must be one of private, unlisted, public (got '${raw}')`,
      "VALIDATION_ERROR",
      ["Example: --privacy unlisted"],
    );
  }
  return found;
}

export function parseFlags(args: string[]): YtUpdateFlags {
  let videoId: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let tagsRaw: string | undefined;
  let privacy: "private" | "unlisted" | "public" | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (videoId === undefined) videoId = arg;
      continue;
    }
    switch (arg) {
      case "--title":
        title = args[++i];
        break;
      case "--description":
        description = args[++i];
        break;
      case "--tags":
        tagsRaw = args[++i];
        break;
      case "--privacy":
        privacy = parsePrivacy(args[++i]);
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi youtube update-video --help\` to see available flags`,
        ]);
    }
  }
  if (videoId === undefined) {
    throw new AxiError("Missing videoId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi youtube update-video <videoId> --title \"...\"",
    ]);
  }
  if (title === undefined && description === undefined && tagsRaw === undefined && privacy === undefined) {
    throw new AxiError(
      "Nothing to update — pass at least one of --title, --description, --tags, --privacy",
      "VALIDATION_ERROR",
      ['Example: youtube update-video <id> --title "Nouveau titre" --privacy unlisted'],
    );
  }
  const tags =
    tagsRaw === undefined
      ? undefined
      : tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t !== "");
  if (tags !== undefined && tags.length === 0) {
    throw new AxiError("--tags is empty — pass at least one tag", "VALIDATION_ERROR", [
      "Example: --tags 'aviation,monaco,hélicoptère'",
    ]);
  }
  return { videoId, title, description, tags, privacy };
}

export async function youtubeUpdateVideoCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await youtubeClient(account);

  // Fetch the current snippet so unspecified fields survive the write (the
  // API requires categoryId on snippet updates; a blind write would strip it).
  let current: {
    snippet?: {
      title?: string | null;
      description?: string | null;
      tags?: string[] | null;
      categoryId?: string | null;
    } | null;
    status?: { privacyStatus?: string | null } | null;
  };
  try {
    const res = await api.videos.list({
      id: [flags.videoId],
      part: ["snippet", "status"],
    });
    const first = (res.data.items ?? [])[0];
    if (!first) {
      throw new AxiError(
        `Video '${flags.videoId}' not found (or ${account} doesn't own it)`,
        "VIDEO_NOT_FOUND",
        [
          "Video ids come from `gws-axi youtube videos` or the URL after v=",
          "Metadata updates require ownership of the video",
        ],
      );
    }
    current = first;
  } catch (err) {
    if (err instanceof AxiError) throw err;
    throw translateGoogleError(err, { account, operation: "youtube.videos.list" });
  }

  const snippet: Record<string, unknown> = {
    title: flags.title ?? current.snippet?.title ?? "",
    description: flags.description ?? current.snippet?.description ?? "",
    categoryId: current.snippet?.categoryId ?? "22",
  };
  if (flags.tags !== undefined) snippet.tags = flags.tags;
  else if (current.snippet?.tags !== undefined && current.snippet.tags !== null)
    snippet.tags = current.snippet.tags;

  const masks: string[] = ["snippet"];
  if (flags.privacy !== undefined) masks.push("status");

  let updated: {
    id?: string | null;
    snippet?: { title?: string | null; tags?: string[] | null } | null;
    status?: { privacyStatus?: string | null } | null;
  };
  try {
    const res = await api.videos.update({
      part: masks,
      requestBody: {
        id: flags.videoId,
        snippet,
        ...(flags.privacy !== undefined ? { status: { privacyStatus: flags.privacy } } : {}),
      },
    });
    updated = res.data;
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "youtube.videos.update" });
  }

  const blocks = [
    renderObject({
      account,
      video: {
        id: updated.id ?? flags.videoId,
        title: updated.snippet?.title ?? flags.title ?? "",
        privacy: updated.status?.privacyStatus ?? flags.privacy ?? "",
        updated_masks: masks.join(","),
        ...(flags.tags !== undefined ? { tags: flags.tags.join(", ") } : {}),
      },
    }),
    renderHelp([
      "Verify with: gws-axi youtube video " + (updated.id ?? flags.videoId),
      "The snippet write preserves categoryId and untouched fields; --tags replaces the whole tag set",
    ]),
  ];
  return joinBlocks(...blocks);
}
