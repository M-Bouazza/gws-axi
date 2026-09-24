import { AxiError } from "axi-sdk-js";
import { translateGoogleError, youtubeClient } from "../../google/client.js";
import { joinBlocks, renderHelp, renderObject } from "../../output/index.js";

export const YT_CHANNEL_HELP = `usage: gws-axi youtube channel [--channel <id>] [flags]
flags[3]:
  --channel <id>       Channel id (UC...) when the account manages several;
                       default: the authenticated account's own channel
  --part <parts>       Comma-separated parts (snippet,statistics,contentDetails,
                       brandingSettings); default: snippet,statistics
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi youtube channel
  gws-axi youtube channel --channel UCxxxxxxxx --part snippet,statistics,contentDetails
output:
  A \`channel{id,title,subs,views,videos,uploads_playlist}\` header
  (counts when statistics is included).
notes:
  Wraps channels.list (mine=true or --channel). \`uploads_playlist\` feeds
  \`youtube videos\`. Costs 1 quota unit. Requires --account <email> when 2+
  accounts are authenticated.
`;

export interface YtChannelFlags {
  channelId?: string;
  parts: string;
}

export function parseFlags(args: string[]): YtChannelFlags {
  let channelId: string | undefined;
  let parts = "snippet,statistics";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--channel":
        channelId = args[++i];
        break;
      case "--part":
        parts = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi youtube channel --help\` to see available flags`,
        ]);
    }
  }
  return { channelId, parts };
}

export interface ChannelInfo {
  id: string;
  title: string;
  subs: string;
  views: string;
  videos: string;
  uploads_playlist: string;
  raw: unknown;
}

export async function getMyChannel(
  account: string,
  flags: YtChannelFlags,
): Promise<ChannelInfo> {
  const api = await youtubeClient(account);
  let channel: {
    id?: string | null;
    snippet?: { title?: string | null; customUrl?: string | null } | null;
    statistics?: {
      subscriberCount?: string | null;
      viewCount?: string | null;
      videoCount?: string | null;
    } | null;
    contentDetails?: {
      relatedPlaylists?: { uploads?: string | null } | null;
    } | null;
  };
  try {
    const res = await api.channels.list({
      part: flags.parts.split(",").map((p) => p.trim()),
      ...(flags.channelId !== undefined ? { id: [flags.channelId] } : { mine: true }),
    });
    const first = (res.data.items ?? [])[0];
    if (!first) {
      throw new AxiError(
        flags.channelId !== undefined
          ? `Channel '${flags.channelId}' not found (or ${account} doesn't manage it)`
          : "No channel under this account — create one at youtube.com, or pass --channel <id> for a managed brand channel",
        "CHANNEL_NOT_FOUND",
        [
          "Get channel ids from the channel URL (UC... portion)",
          "Brand-account channels are managed via the account's channel switcher",
        ],
      );
    }
    channel = first;
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const translated = translateGoogleError(err, {
      account,
      operation: "youtube.channels.list",
    });
    if (translated.code === "API_NOT_ENABLED") {
      throw new AxiError(
        "YouTube Data API v3 is not enabled for this GCP project",
        "API_NOT_ENABLED",
        ["Re-run `gws-axi auth setup` — the API-enable flow will fix this"],
      );
    }
    throw translated;
  }

  return {
    id: channel.id ?? "",
    title: channel.snippet?.title ?? "",
    subs: channel.statistics?.subscriberCount ?? "",
    views: channel.statistics?.viewCount ?? "",
    videos: channel.statistics?.videoCount ?? "",
    uploads_playlist: channel.contentDetails?.relatedPlaylists?.uploads ?? "",
    raw: channel,
  };
}

export async function youtubeChannelCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const channel = await getMyChannel(account, flags);
  const blocks = [
    renderObject({
      account,
      channel: {
        id: channel.id,
        title: channel.title,
        subs: channel.subs,
        views: channel.views,
        videos: channel.videos,
        uploads_playlist: channel.uploads_playlist,
      },
    }),
    renderHelp([
      "List recent videos: gws-axi youtube videos",
      "Detailed parts via --part (snippet,statistics,contentDetails,brandingSettings)",
    ]),
  ];
  return joinBlocks(...blocks);
}
