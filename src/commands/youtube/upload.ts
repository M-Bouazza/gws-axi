import { existsSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { AxiError } from "axi-sdk-js";
import { translateGoogleError, youtubeClient } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const YT_UPLOAD_HELP = `usage: gws-axi youtube upload <file> --title <text> [flags]
args[1]:
  <file>               Local video file (.mp4, .mov, .avi, .wmv — YouTube-supported)
flags[5]:
  --title <text>       Video title (required)
  --description <text> Video description
  --privacy <status>   private (default) | unlisted | public
  --channel <id>       Channel id when the account manages several
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi youtube upload ./montage.mp4 --title "Baptême hélico - Teaser" --privacy unlisted
output:
  A \`video{id,title,privacy,file_size}\` block reporting the upload.
notes:
  Wraps videos.insert (resumable, 1600 quota units — 16% of the 10k/day
  default). The upload requires the youtube.upload scope (re-consent via
  \`gws auth login\` if missing — \`gws doctor\` surfaces it). Publishing
  ('--privacy public') is a REAL publication: never upload to a live channel
  without Mehdi's explicit validation. Requires --account <email> when 2+
  accounts are authenticated.
`;

export interface YtUploadFlags {
  file: string;
  title: string;
  description?: string;
  privacy: "private" | "unlisted" | "public";
  channelId?: string;
}

export function parseFlags(args: string[]): YtUploadFlags {
  let file: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let privacy: "private" | "unlisted" | "public" = "private";
  let channelId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (file === undefined) file = arg;
      continue;
    }
    switch (arg) {
      case "--title":
        title = args[++i];
        break;
      case "--description":
        description = args[++i];
        break;
      case "--privacy":
        privacy = parsePrivacyFlag(args[++i]);
        break;
      case "--channel":
        channelId = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi youtube upload --help\` to see available flags`,
        ]);
    }
  }
  if (file === undefined) {
    throw new AxiError("Missing file argument", "VALIDATION_ERROR", [
      "Usage: gws-axi youtube upload <file> --title \"...\" [--privacy private|unlisted|public]",
    ]);
  }
  if (title === undefined) {
    throw new AxiError("Missing --title", "VALIDATION_ERROR", [
      'Example: --title "Baptême hélico - Teaser 2026"',
    ]);
  }
  return { file, title, description, privacy, channelId };
}

function parsePrivacyFlag(raw: string): "private" | "unlisted" | "public" {
  const norm = raw.trim().toLowerCase();
  if (norm === "private" || norm === "unlisted" || norm === "public") return norm;
  throw new AxiError(
    `--privacy must be one of private, unlisted, public (got '${raw}')`,
    "VALIDATION_ERROR",
    ["Example: --privacy unlisted"],
  );
}

export async function youtubeUploadCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  if (!existsSync(flags.file)) {
    throw new AxiError(`Video file not found: ${flags.file}`, "VALIDATION_ERROR", [
      "Pass a path to a local video file (mp4/mov/avi/wmv per YouTube ingestion)",
    ]);
  }
  const stat = statSync(flags.file);
  if (!stat.isFile() || stat.size === 0) {
    throw new AxiError(`'${flags.file}' is not a non-empty file`, "VALIDATION_ERROR", []);
  }

  const api = await youtubeClient(account);
  let created: {
    id?: string | null;
    snippet?: { title?: string | null } | null;
    status?: { privacyStatus?: string | null } | null;
  };
  try {
    const res = await api.videos.insert(
      {
        part: ["snippet", "status"],
        requestBody: {
          snippet: {
            title: flags.title,
            ...(flags.description !== undefined ? { description: flags.description } : {}),
          },
          status: { privacyStatus: flags.privacy, selfDeclaredMadeForKids: false },
        },
        media: { body: createReadStream(flags.file) },
        ...(flags.channelId !== undefined ? { onBehalfOfContentOwnerChannel: flags.channelId } : {}),
      },
      {
        onUploadProgress: (evt): void => {
          // Progress lines would pollute the TOON output — silent by design.
          void evt;
        },
      },
    );
    created = res.data;
  } catch (err) {
    const translated = translateGoogleError(err, { account, operation: "youtube.videos.insert" });
    if (translated.code === "FORBIDDEN" && /upload/i.test(String(err))) {
      throw new AxiError(
        `Upload refused for ${account} — the youtube.upload scope is missing`,
        "SCOPE_MISSING",
        ["Run `gws-axi auth login --account " + account + "` to re-consent, or `gws doctor` to check"],
      );
    }
    throw translated;
  }

  const blocks = [
    renderObject({
      account,
      video: {
        id: created.id ?? "",
        title: created.snippet?.title ?? flags.title,
        privacy: created.status?.privacyStatus ?? flags.privacy,
        file_size_mb: Math.round(stat.size / 1_000_000),
        url: created.id !== undefined && created.id !== null && created.id !== ""
          ? `https://youtu.be/${created.id}`
          : "",
      },
    }),
    renderHelp([
      "List videos: gws-axi youtube videos --limit 5",
      "Edit metadata: gws-axi youtube update-video <id> --title \"...\"",
      created.status?.privacyStatus === "public"
        ? "This video is PUBLIC — published on the channel"
        : "The video is not public: set --privacy public later via `youtube update-video <id> --privacy public` when validated",
    ]),
  ];
  return joinBlocks(...blocks);
}
