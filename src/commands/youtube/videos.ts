import { AxiError } from "axi-sdk-js";
import type { youtube_v3 } from "googleapis";
import { translateGoogleError, youtubeClient } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";
import { getMyChannel, YtChannelFlags } from "./channel.js";

export const YT_VIDEOS_HELP = `usage: gws-axi youtube videos [--channel <id>] [--limit <n>] [flags]
flags[4]:
  --channel <id>       Channel id (UC...); default: the account's own channel
  --limit <n>          Max videos (default: 20, max: 50)
  --details            Include stats per video (views, likes, comments —
                       1 extra quota unit per batch of 50)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi youtube videos --limit 10
  gws-axi youtube videos --channel UCxxx --details
output:
  A \`videos[N]{id,title,published,duration,views,likes,comments,privacy}\`
  table ordered newest-first (from the channel's uploads playlist).
notes:
  Costs 1 unit per playlist page (50 items) + 1 per details batch.
  Video ids feed \`youtube video <id>\`, \`youtube update-video <id>\`,
  \`youtube comments <id>\`. Requires --account <email> when 2+ accounts
  are authenticated.
`;

export interface YtVideosFlags {
  channelId?: string;
  limit: number;
  details: boolean;
}

export function parseFlags(args: string[]): YtVideosFlags {
  let channelId: string | undefined;
  let limit = 20;
  let details = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--channel":
        channelId = args[++i];
        break;
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 20 : Math.max(1, Math.min(50, n));
        break;
      }
      case "--details":
        details = true;
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi youtube videos --help\` to see available flags`,
        ]);
    }
  }
  return { channelId, limit, details };
}

export interface VideoRow {
  id: string;
  title: string;
  published: string;
  duration: string;
  views: string;
  likes: string;
  comments: string;
  privacy: string;
}

export async function listChannelVideos(
  account: string,
  flags: YtVideosFlags,
): Promise<VideoRow[]> {
  const api = await youtubeClient(account);
  const channel = await getMyChannel(account, {
    channelId: flags.channelId,
    parts: "contentDetails",
  });
  if (channel.uploads_playlist === "") {
    throw new AxiError(
      `Channel '${channel.id}' has no uploads playlist (no videos yet)`,
      "NO_UPLOADS",
      ["The channel has no public uploads — uploads appear in the playlist once published"],
    );
  }

  let playlistItems: youtube_v3.Schema$PlaylistItem[];
  try {
    const res = await api.playlistItems.list({
      playlistId: channel.uploads_playlist,
      maxResults: flags.limit,
      part: ["snippet", "contentDetails"],
    });
    playlistItems = res.data.items ?? [];
  } catch (err) {
    throw translateGoogleError(err, { account, operation: "youtube.playlistItems.list" });
  }

  const ids = playlistItems
    .map((item) => item.contentDetails?.videoId ?? "")
    .filter((id) => id !== "");

  const stats = new Map<string, youtube_v3.Schema$Video>();
  if (flags.details && ids.length > 0) {
    try {
      const res = await api.videos.list({
        id: ids,
        part: ["statistics", "status", "contentDetails"],
      });
      for (const video of res.data.items ?? []) {
        stats.set(video.id ?? "", video);
      }
    } catch (err) {
      throw translateGoogleError(err, { account, operation: "youtube.videos.list" });
    }
  }

  return playlistItems.map((item) => {
    const id = item.contentDetails?.videoId ?? "";
    const statsFor = stats.get(id);
    return {
      id,
      title: item.snippet?.title ?? "",
      published: (item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? "").slice(0, 10),
      duration: statsFor?.contentDetails?.duration ?? "",
      views: statsFor?.statistics?.viewCount ?? "",
      likes: statsFor?.statistics?.likeCount ?? "",
      comments: statsFor?.statistics?.commentCount ?? "",
      privacy: statsFor?.status?.privacyStatus ?? "",
    };
  });
}

export async function youtubeVideosCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const rows = await listChannelVideos(account, flags);
  return joinBlocks(
    renderObject({ account, channel: flags.channelId ?? "mine" }),
    renderListResponse({
      name: "videos",
      items: rows as unknown as Array<Record<string, unknown>>,
      schema: [
        field("id"),
        field("title"),
        field("published"),
        field("duration"),
        field("views"),
        field("likes"),
        field("comments"),
        field("privacy"),
      ],
      emptyMessage: "no videos in the uploads playlist yet",
    }),
    renderHelp([
      "Video detail: gws-axi youtube video <id>",
      "Edit metadata: gws-axi youtube update-video <id> --title \"...\"",
      "Read comments: gws-axi youtube comments <id>",
    ]),
  );
}
