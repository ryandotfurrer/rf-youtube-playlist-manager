/**
 * YouTube Data API v3 wrapper.
 * All methods route through the background service worker
 * for authenticated requests.
 *
 * Quota costs per operation:
 *   - playlistItems.list:  1 unit
 *   - videos.list:         1 unit
 *   - playlists.list:      1 unit
 *   - playlistItems.insert: 50 units
 *   - playlistItems.delete: 50 units
 *
 * Daily quota: 10,000 units. Bulk operations should warn the user.
 */

import { apiRequest } from "./auth";
import type {
  YouTubeListResponse,
  YouTubePlaylistItem,
  YouTubePlaylist,
  YouTubeVideo,
} from "../../types/youtube";

const API_BASE = "https://www.googleapis.com/youtube/v3";

// ─── Playlist Items ───────────────────────────────────────────────

/**
 * Fetches a single page of playlist items.
 * Returns up to `maxResults` items (max 50 per page).
 *
 * Quota cost: 1 unit per call.
 */
export async function listPlaylistItems(
  playlistId: string,
  pageToken?: string,
  maxResults: number = 50,
): Promise<YouTubeListResponse<YouTubePlaylistItem>> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails,status",
    playlistId,
    maxResults: String(maxResults),
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  return apiRequest<YouTubeListResponse<YouTubePlaylistItem>>({
    url: `${API_BASE}/playlistItems?${params}`,
    method: "GET",
  });
}

/**
 * Fetches ALL playlist items by paginating through the full list.
 * Use with caution on very large playlists (each page = 1 quota unit).
 */
export async function listAllPlaylistItems(
  playlistId: string,
): Promise<YouTubePlaylistItem[]> {
  const allItems: YouTubePlaylistItem[] = [];
  let pageToken: string | undefined;

  do {
    const response = await listPlaylistItems(playlistId, pageToken);
    allItems.push(...response.items);
    pageToken = response.nextPageToken;
  } while (pageToken);

  return allItems;
}

/**
 * Adds a video to a playlist.
 *
 * Quota cost: 50 units per call.
 */
export async function insertPlaylistItem(
  playlistId: string,
  videoId: string,
): Promise<YouTubePlaylistItem> {
  return apiRequest<YouTubePlaylistItem>({
    url: `${API_BASE}/playlistItems?part=snippet`,
    method: "POST",
    body: {
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId,
        },
      },
    },
  });
}

/**
 * Removes a video from a playlist by its playlist item ID.
 *
 * Quota cost: 50 units per call.
 */
export async function deletePlaylistItem(
  playlistItemId: string,
): Promise<void> {
  await apiRequest<null>({
    url: `${API_BASE}/playlistItems?id=${encodeURIComponent(playlistItemId)}`,
    method: "DELETE",
  });
}

/**
 * Batch delete multiple playlist items sequentially.
 * Calls the provided `onProgress` callback after each deletion.
 *
 * Quota cost: 50 units per item.
 */
export async function deletePlaylistItems(
  playlistItemIds: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<{ succeeded: string[]; failed: { id: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (let i = 0; i < playlistItemIds.length; i++) {
    try {
      await deletePlaylistItem(playlistItemIds[i]);
      succeeded.push(playlistItemIds[i]);
    } catch (err) {
      failed.push({
        id: playlistItemIds[i],
        error: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.(i + 1, playlistItemIds.length);
  }

  return { succeeded, failed };
}

/**
 * Batch insert videos into a playlist sequentially.
 * Calls the provided `onProgress` callback after each insertion.
 *
 * Quota cost: 50 units per item.
 */
export async function insertPlaylistItems(
  playlistId: string,
  videoIds: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<{
  succeeded: string[];
  failed: { videoId: string; error: string }[];
}> {
  const succeeded: string[] = [];
  const failed: { videoId: string; error: string }[] = [];

  for (let i = 0; i < videoIds.length; i++) {
    try {
      await insertPlaylistItem(playlistId, videoIds[i]);
      succeeded.push(videoIds[i]);
    } catch (err) {
      failed.push({
        videoId: videoIds[i],
        error: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.(i + 1, videoIds.length);
  }

  return { succeeded, failed };
}

// ─── Playlists ────────────────────────────────────────────────────

/**
 * Fetches the authenticated user's playlists.
 *
 * Quota cost: 1 unit per call.
 */
export async function listMyPlaylists(
  pageToken?: string,
  maxResults: number = 50,
): Promise<YouTubeListResponse<YouTubePlaylist>> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails,status",
    mine: "true",
    maxResults: String(maxResults),
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  return apiRequest<YouTubeListResponse<YouTubePlaylist>>({
    url: `${API_BASE}/playlists?${params}`,
    method: "GET",
  });
}

/**
 * Fetches ALL of the authenticated user's playlists.
 */
export async function listAllMyPlaylists(): Promise<YouTubePlaylist[]> {
  const allPlaylists: YouTubePlaylist[] = [];
  let pageToken: string | undefined;

  do {
    const response = await listMyPlaylists(pageToken);
    allPlaylists.push(...response.items);
    pageToken = response.nextPageToken;
  } while (pageToken);

  return allPlaylists;
}

/**
 * Creates a new playlist for the authenticated user.
 *
 * Quota cost: 50 units.
 */
export async function createPlaylist(
  title: string,
  privacyStatus: "public" | "unlisted" | "private" = "private",
  description: string = "",
): Promise<YouTubePlaylist> {
  return apiRequest<YouTubePlaylist>({
    url: `${API_BASE}/playlists?part=snippet,status`,
    method: "POST",
    body: {
      snippet: {
        title,
        description,
      },
      status: {
        privacyStatus,
      },
    },
  });
}

// ─── Videos (for durations) ───────────────────────────────────────

/**
 * Fetches video details for the given video IDs.
 * The YouTube API allows up to 50 IDs per request.
 *
 * Quota cost: 1 unit per call.
 */
export async function getVideoDetails(
  videoIds: string[],
): Promise<YouTubeVideo[]> {
  if (videoIds.length === 0) return [];

  // YouTube API accepts max 50 IDs per request
  const chunks = chunkArray(videoIds, 50);
  const allVideos: YouTubeVideo[] = [];

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      part: "contentDetails,snippet",
      id: chunk.join(","),
    });

    const response = await apiRequest<YouTubeListResponse<YouTubeVideo>>({
      url: `${API_BASE}/videos?${params}`,
      method: "GET",
    });

    allVideos.push(...response.items);
  }

  return allVideos;
}

/**
 * Returns a map of videoId -> ISO 8601 duration string.
 */
export async function getVideoDurations(
  videoIds: string[],
): Promise<Map<string, string>> {
  const videos = await getVideoDetails(videoIds);
  const map = new Map<string, string>();

  for (const video of videos) {
    map.set(video.id, video.contentDetails.duration);
  }

  return map;
}

// ─── Playlist Reordering ──────────────────────────────────────────

/**
 * Updates a single playlist item's position.
 *
 * Quota cost: 50 units per call.
 */
export async function updatePlaylistItemPosition(
  playlistItemId: string,
  playlistId: string,
  videoId: string,
  position: number,
): Promise<void> {
  await apiRequest({
    url: `${API_BASE}/playlistItems?part=snippet`,
    method: "PUT",
    body: {
      id: playlistItemId,
      snippet: {
        playlistId,
        resourceId: {
          kind: "youtube#video",
          videoId,
        },
        position,
      },
    },
  });
}

/**
 * Reorders an entire playlist by setting each item's position
 * sequentially. Items must be in the desired target order.
 *
 * Quota cost: 50 units per item.
 *
 * @param items - Playlist items in the desired order.
 * @param playlistId - The playlist to reorder.
 * @param onProgress - Called after each item is repositioned.
 * @returns Results with succeeded/failed counts.
 */
export async function reorderPlaylist(
  items: Array<{ playlistItemId: string; videoId: string }>,
  playlistId: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ succeeded: number; failed: { index: number; error: string }[] }> {
  let succeeded = 0;
  const failed: { index: number; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      await updatePlaylistItemPosition(
        items[i].playlistItemId,
        playlistId,
        items[i].videoId,
        i,
      );
      succeeded++;
    } catch (err) {
      failed.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    onProgress?.(i + 1, items.length);
  }

  return { succeeded, failed };
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Splits an array into chunks of the given size. */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
