import { AxiError } from "axi-sdk-js";
import { translateGoogleError, youtubeClient } from "../../google/client.js";
import {
  field,
  joinBlocks,
  renderHelp,
  renderListResponse,
  renderObject,
} from "../../output/index.js";

export const YT_COMMENTS_HELP = `usage: gws-axi youtube comments <videoId> [flags]
args[1]:
  <videoId>            Video id (from \`youtube videos\` or the URL)
flags[3]:
  --limit <n>          Max threads (default: 20, max: 100)
  --order <order>      time | relevance (default: time)
  --account <email>    Account override when 2+ are configured
examples:
  gws-axi youtube comments dQw4w9WgXcQ --limit 30
output:
  A \`comments[N]{id,author,text,likes,published,replies}\` table over the
  top-level comment threads (replies counted, not expanded).
notes:
  Wraps commentThreads.list (1 quota unit per call). Comment ids feed future
  moderation (reply / moderate — planned). Requires --account <email> when
  2+ accounts are authenticated.
`;

export interface YtCommentsFlags {
  videoId: string;
  limit: number;
  order: string;
}

export function parseFlags(args: string[]): YtCommentsFlags {
  let videoId: string | undefined;
  let limit = 20;
  let order = "time";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      if (videoId === undefined) videoId = arg;
      continue;
    }
    switch (arg) {
      case "--limit": {
        const n = parseInt(args[++i], 10);
        limit = Number.isNaN(n) ? 20 : Math.max(1, Math.min(100, n));
        break;
      }
      case "--order":
        order = args[++i];
        break;
      default:
        throw new AxiError(`Unknown flag: ${arg}`, "VALIDATION_ERROR", [
          `Run \`gws-axi youtube comments --help\` to see available flags`,
        ]);
    }
  }
  if (videoId === undefined) {
    throw new AxiError("Missing videoId argument", "VALIDATION_ERROR", [
      "Usage: gws-axi youtube comments <videoId> [--limit <n>] [--order time|relevance]",
    ]);
  }
  if (order !== "time" && order !== "relevance") {
    throw new AxiError(`--order must be 'time' or 'relevance' (got '${order}')`, "VALIDATION_ERROR", [
      "Example: --order relevance",
    ]);
  }
  return { videoId, limit, order };
}

export async function youtubeCommentsCommand(account: string, args: string[]): Promise<string> {
  const flags = parseFlags(args);
  const api = await youtubeClient(account);
  let threads: Array<{
    id?: string | null;
    snippet?: {
      topLevelComment?: {
        snippet?: {
          authorDisplayName?: string | null;
          textDisplay?: string | null;
          likeCount?: number | null;
          publishedAt?: string | null;
        } | null;
      } | null;
    } | null;
    replies?: unknown[];
  }>;
  try {
    const res = await api.commentThreads.list({
      videoId: flags.videoId,
      part: ["snippet"],
      maxResults: flags.limit,
      order: flags.order === "relevance" ? "relevance" : "time",
      textFormat: "plainText",
    });
    threads = (res.data.items ?? []) as typeof threads;
  } catch (err) {
    const translated = translateGoogleError(err, {
      account,
      operation: "youtube.commentThreads.list",
    });
    if (translated.code === "FORBIDDEN") {
      throw new AxiError(
        `Comments are disabled or restricted on video '${flags.videoId}'`,
        "COMMENTS_DISABLED",
        ["The video owner disabled comments, or they are held for review"],
      );
    }
    throw translated;
  }

  const rows = threads.map((thread) => {
    const top = thread.snippet?.topLevelComment?.snippet ?? {};
    return {
      id: thread.id ?? "",
      author: top.authorDisplayName ?? "",
      text: (top.textDisplay ?? "").replace(/\n/g, " ").slice(0, 160),
      likes: top.likeCount ?? 0,
      published: (top.publishedAt ?? "").slice(0, 10),
      replies: thread.replies?.length ?? 0,
    };
  });

  return joinBlocks(
    renderObject({ account, video: flags.videoId, threads: rows.length }),
    renderListResponse({
      name: "comments",
      items: rows,
      schema: [
        field("id"),
        field("author"),
        field("text"),
        field("likes"),
        field("published"),
        field("replies"),
      ],
      emptyMessage: "no comment threads on this video",
    }),
    renderHelp(["Order: time (newest first) or relevance (top comments)"]),
  );
}
