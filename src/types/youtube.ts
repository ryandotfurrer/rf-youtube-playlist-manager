/**
 * TypeScript interfaces for YouTube Data API v3 responses
 * and internal extension data models.
 */

// ─── YouTube Data API v3 Response Types ───────────────────────────

/** Generic paginated list response from the YouTube API. */
export interface YouTubeListResponse<T> {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: T[];
}

/** A playlistItem resource from the YouTube API. */
export interface YouTubePlaylistItem {
  kind: "youtube#playlistItem";
  etag: string;
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: YouTubeThumbnails;
    channelTitle: string;
    playlistId: string;
    position: number;
    resourceId: {
      kind: string;
      videoId: string;
    };
  };
  contentDetails: {
    videoId: string;
    videoPublishedAt?: string;
    note?: string;
  };
  status?: {
    privacyStatus: "public" | "unlisted" | "private";
  };
}

/** A playlist resource from the YouTube API. */
export interface YouTubePlaylist {
  kind: "youtube#playlist";
  etag: string;
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: YouTubeThumbnails;
    channelTitle: string;
  };
  contentDetails: {
    itemCount: number;
  };
  status?: {
    privacyStatus: "public" | "unlisted" | "private";
  };
}

/** A video resource (used for fetching durations). */
export interface YouTubeVideo {
  kind: "youtube#video";
  etag: string;
  id: string;
  contentDetails: {
    duration: string; // ISO 8601 duration, e.g. "PT12M34S"
    dimension: string;
    definition: string;
  };
  snippet?: {
    publishedAt: string;
    title: string;
    channelTitle: string;
    thumbnails: YouTubeThumbnails;
  };
}

/** Thumbnail map returned by various YouTube resources. */
export interface YouTubeThumbnails {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeThumbnail {
  url: string;
  width: number;
  height: number;
}

// ─── Message Types (content script <-> background) ────────────────

export type MessageType =
  | "GET_AUTH_TOKEN"
  | "REMOVE_AUTH_TOKEN"
  | "API_REQUEST";

export interface ExtensionMessage {
  type: MessageType;
  payload?: ApiRequestPayload;
}

export interface ApiRequestPayload {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
}

export interface ExtensionResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Internal Extension Models ────────────────────────────────────

/** Parsed video item from the playlist DOM + API data. */
export interface PlaylistVideoItem {
  /** The playlist item ID (needed for delete/update API calls). */
  playlistItemId: string;
  /** The YouTube video ID. */
  videoId: string;
  /** Video title. */
  title: string;
  /** Channel that uploaded the video. */
  channelTitle: string;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Duration display string, e.g. "12:34". */
  durationText: string;
  /** ISO 8601 date string of when the video was published to YouTube. */
  publishedAt: string;
  /** Watch progress as a percentage (0-100). 0 = unwatched. */
  watchProgress: number;
  /** Whether the video is fully watched (100%). */
  isFullyWatched: boolean;
  /** Reference to the DOM element for this video in the playlist. */
  element: HTMLElement;
  /** The original index/position in the playlist. */
  originalIndex: number;
  /** Whether video metadata (publishedAt, accurate duration) has been enriched from the API. */
  metadataEnriched: boolean;
}

// ─── Sort Types ───────────────────────────────────────────────────

/** Available fields for sorting. */
export type SortField = "duration" | "published";

/** A single level in a multi-level sort. */
export interface SortLevel {
  field: SortField;
  direction: "asc" | "desc";
}

/** Sort mode — whether to persist via API or just reorder the DOM. */
export type SortMode = "api" | "visual";

/** Maximum playlist size for API-based reordering. */
export const API_SORT_THRESHOLD = 100;
