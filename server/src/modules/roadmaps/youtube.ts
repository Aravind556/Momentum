import { env } from "../../core/env.js";
import { fetchWithRetry, IntegrationError, type FetchFn } from "../platforms/types.js";

export interface PlaylistMetadata {
  playlistId: string;
  title: string;
  items: Array<{ position: number; videoId: string; title: string; durationSeconds: number; url: string }>;
  skipped: number;
}

/** Extracts the playlist id from youtube.com / youtu.be / music.youtube.com URLs. */
export function parsePlaylistId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (!["youtube.com", "youtu.be", "music.youtube.com"].includes(host)) return null;
  const id = url.searchParams.get("list");
  return id && /^[A-Za-z0-9_-]{10,64}$/.test(id) ? id : null;
}

/** ISO-8601 duration (PT1H2M3S) to seconds. */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/**
 * Retrieves playlist metadata with the YouTube Data API v3 (requires YOUTUBE_API_KEY).
 * Private or deleted videos are skipped and counted. Playback progress cannot be read with an
 * API key, so video completion is always self-reported.
 */
export async function fetchPlaylist(playlistId: string, fetchFn: FetchFn = fetch, maxItems = 500): Promise<PlaylistMetadata> {
  if (!env.youtubeApiKey) throw new IntegrationError("YouTube import is not configured on this server", "unavailable");
  const key = encodeURIComponent(env.youtubeApiKey);
  const meta = await fetchWithRetry(fetchFn, `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${key}`, {});
  if (meta.status === 403) throw new IntegrationError("YouTube API quota exceeded or key rejected", "auth");
  if (!meta.ok) throw new IntegrationError(`YouTube responded with ${meta.status}`, "unavailable");
  const metaBody = (await meta.json()) as { items?: Array<{ snippet?: { title?: string } }> };
  const title = metaBody.items?.[0]?.snippet?.title;
  if (!title) throw new IntegrationError("Playlist not found — it may be private or deleted", "not_found");

  const ids: Array<{ videoId: string; title: string }> = [];
  let pageToken = "";
  do {
    const res = await fetchWithRetry(
      fetchFn,
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      {},
    );
    if (res.status === 404) throw new IntegrationError("Playlist not found — it may be private or deleted", "not_found");
    if (!res.ok) throw new IntegrationError(`YouTube responded with ${res.status}`, "unavailable");
    const body = (await res.json()) as {
      nextPageToken?: string;
      items?: Array<{ contentDetails?: { videoId?: string }; snippet?: { title?: string } }>;
    };
    for (const it of body.items ?? []) {
      const videoId = it.contentDetails?.videoId;
      if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) ids.push({ videoId, title: String(it.snippet?.title ?? "Video").slice(0, 200) });
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken && ids.length < maxItems);

  const durations = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).map((v) => v.videoId).join(",");
    const res = await fetchWithRetry(fetchFn, `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch}&key=${key}`, {});
    if (!res.ok) throw new IntegrationError(`YouTube responded with ${res.status}`, "unavailable");
    const body = (await res.json()) as { items?: Array<{ id: string; contentDetails?: { duration?: string } }> };
    for (const v of body.items ?? []) durations.set(v.id, parseIsoDuration(v.contentDetails?.duration ?? ""));
  }

  const items: PlaylistMetadata["items"] = [];
  let skipped = 0;
  for (const v of ids.slice(0, maxItems)) {
    const d = durations.get(v.videoId);
    if (!d) {
      skipped += 1; // private, deleted or live content without a duration
      continue;
    }
    items.push({
      position: items.length + 1,
      videoId: v.videoId,
      title: v.title,
      durationSeconds: d,
      url: `https://www.youtube.com/watch?v=${v.videoId}&list=${playlistId}`,
    });
  }
  if (!items.length) throw new IntegrationError("No playable videos with known durations in this playlist", "not_found");
  return { playlistId, title, items, skipped };
}
