import { AxiError } from "axi-sdk-js";
import { resolveAccount, withAccountSource } from "../google/account.js";
import { notImplemented, renderAlternatives, withInstead } from "./stub-signposts.js";
import { YT_CHANNEL_HELP, youtubeChannelCommand } from "./youtube/channel.js";
import { YT_COMMENTS_HELP, youtubeCommentsCommand } from "./youtube/comments.js";
import { YT_UPDATE_HELP, youtubeUpdateVideoCommand } from "./youtube/update-video.js";
import { YT_UPLOAD_HELP, youtubeUploadCommand } from "./youtube/upload.js";
import { YT_VIDEOS_HELP, youtubeVideosCommand } from "./youtube/videos.js";

interface YoutubeSubcommand {
  name: string;
  mutation: boolean;
  help: string;
  handler?: (account: string, args: string[]) => Promise<string>;
  instead?: string[];
}

const VIDEO_HELP = `usage: gws-axi youtube video <videoId> [flags]
status: planned — not yet implemented
notes:
  Will wrap videos.list for a single video (snippet + statistics + status).
  In the meantime: \`youtube videos --details\` lists recent videos with
  stats, or use \`youtube channel\` for the channel-level view.
`;

const THUMBNAIL_HELP = `usage: gws-axi youtube thumbnail <videoId> --file <image> [flags]
status: planned — not yet implemented
notes:
  Will wrap thumbnails.set (custom thumbnail, 50 quota units, verified
  accounts only).
`;

const PLAYLISTS_HELP = `usage: gws-axi youtube playlists [flags]
status: planned — not yet implemented
`;

const SUBCOMMANDS: YoutubeSubcommand[] = [
  { name: "channel", mutation: false, help: YT_CHANNEL_HELP, handler: youtubeChannelCommand },
  { name: "videos", mutation: false, help: YT_VIDEOS_HELP, handler: youtubeVideosCommand },
  { name: "comments", mutation: false, help: YT_COMMENTS_HELP, handler: youtubeCommentsCommand },
  { name: "update-video", mutation: true, help: YT_UPDATE_HELP, handler: youtubeUpdateVideoCommand },
  { name: "upload", mutation: true, help: YT_UPLOAD_HELP, handler: youtubeUploadCommand },
  { name: "video", mutation: false, help: VIDEO_HELP },
  { name: "thumbnail", mutation: true, help: THUMBNAIL_HELP },
  { name: "playlists", mutation: false, help: PLAYLISTS_HELP },
];

const SUB_BY_NAME: Record<string, YoutubeSubcommand> = Object.fromEntries(
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

export const YOUTUBE_HELP = `usage: gws-axi youtube <subcommand> [args] [--account <email>] [flags]
reads[${reads.length}]:
  ${reads.join(", ")}
writes[${writes.length}]:
  ${writes.join(", ")}
notes:
  Writes require --account <email> when 2+ accounts are authenticated.
  Reads use the default account when --account is not provided.
  channel/videos/comments and update-video/upload are implemented; video
  detail, thumbnail and playlists are scaffolded. Quota: 10k units/day
  default (upload = 1600, metadata = 50, reads = 1).
${renderAlternatives(SUBCOMMANDS)}subcommand help:
  gws-axi youtube channel --help       for channel stats + uploads playlist
  gws-axi youtube videos --help        for the recent uploads table
  gws-axi youtube comments --help      for a video's comment threads
  gws-axi youtube update-video --help  for metadata edits (title/desc/tags/privacy)
  gws-axi youtube upload --help        for video upload (youtube.upload scope)
examples:
  gws-axi youtube channel
  gws-axi youtube videos --limit 10 --details
  gws-axi youtube comments dQw4w9WgXcQ
  gws-axi youtube update-video dQw4w9WgXcQ --title "Nouveau titre" --privacy unlisted
  gws-axi youtube upload ./montage.mp4 --title "Teaser" --privacy unlisted
`;

export async function youtubeCommand(args: string[]): Promise<string> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return YOUTUBE_HELP;
  }

  const sub = args[0];
  const def = SUB_BY_NAME[sub];
  if (!def) {
    throw new AxiError(`Unknown youtube subcommand: ${sub}`, "VALIDATION_ERROR", [
      `Run \`gws-axi youtube --help\` to see available subcommands`,
    ]);
  }

  const rest = args.slice(1);
  if (rest.includes("--help")) {
    return def.handler ? def.help : withInstead(def.help, def.instead);
  }

  const { account: accountFlag, rest: remaining } = parseAccountFlag(rest);
  const resolution = resolveAccount(accountFlag, {
    mutation: def.mutation,
    commandName: `youtube ${sub}`,
  });

  if (!def.handler) {
    throw notImplemented("youtube", sub, resolution.account, def.instead);
  }

  return withAccountSource(resolution, await def.handler(resolution.account, remaining));
}
