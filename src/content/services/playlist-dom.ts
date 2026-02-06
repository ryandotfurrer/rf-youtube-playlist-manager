/**
 * DOM parsing utilities for YouTube playlist pages.
 * Extracts video items, video IDs, watch progress, durations,
 * and playlist item metadata from the page DOM.
 *
 * YouTube DOM selectors (subject to change if YouTube updates their UI):
 *
 *   Playlist container:   ytd-playlist-video-list-renderer
 *   Video items:          ytd-playlist-video-renderer
 *   Video title:          #video-title
 *   Duration badge:       ytd-thumbnail-overlay-time-status-renderer
 *                           -> span#text (contains "12:34")
 *   Watch progress bar:   ytd-thumbnail-overlay-resume-playback-renderer
 *                           -> div#progress (width % = watch progress)
 *   Watched badge:        If progress bar width is 100%
 *   Video link:           a#video-title (href contains ?v=VIDEO_ID)
 *   Channel name:         ytd-channel-name a, or .ytd-channel-name
 *   Index badge:          #index (the position number in the playlist)
 */

import type { PlaylistVideoItem } from "../../types/youtube";
import { qs, qsa } from "../utils/dom-helpers";
import { parseDurationText, parseISO8601Duration, formatDuration } from "../utils/duration";
import { listAllPlaylistItems, getVideoDetails } from "./youtube-api";

// ─── Selectors ────────────────────────────────────────────────────

const SEL = {
  /** The playlist video list container. */
  playlistContainer: "ytd-playlist-video-list-renderer",

  /** Individual video renderer elements. */
  videoItem: "ytd-playlist-video-renderer",

  /** The anchor element containing the video title and link. */
  videoTitleLink: "a#video-title",

  /** Duration overlay on the thumbnail. */
  durationBadge: "ytd-thumbnail-overlay-time-status-renderer",

  /** The text span inside the duration badge. */
  durationText: "span#text",

  /** Resume playback overlay (watch progress). */
  progressOverlay: "ytd-thumbnail-overlay-resume-playback-renderer",

  /** The progress bar div inside the resume overlay. */
  progressBar: "div#progress",

  /** Channel name element. */
  channelName: "ytd-channel-name a.yt-simple-endpoint",

  /** Index number in the playlist. */
  indexBadge: "#index",
} as const;

// ─── Playlist Detection ──────────────────────────────────────────

/**
 * Extracts the playlist ID from the current page URL.
 * Returns null if not on a playlist page.
 */
export function getPlaylistIdFromUrl(): string | null {
  const url = new URL(window.location.href);
  return url.searchParams.get("list");
}

/**
 * Returns true if the current page is a playlist page.
 */
export function isPlaylistPage(): boolean {
  return (
    window.location.pathname === "/playlist" &&
    getPlaylistIdFromUrl() !== null
  );
}

/**
 * Returns the playlist container element, or null if not found.
 */
export function getPlaylistContainer(): HTMLElement | null {
  return qs(SEL.playlistContainer);
}

// ─── Video Item Parsing ──────────────────────────────────────────

/**
 * Parses all video items currently in the DOM from the playlist.
 * Note: YouTube lazy-loads playlist items, so this may not return
 * all videos in a large playlist. Use scrollToLoadAll() first
 * if you need the complete list.
 */
export function parseVideoItems(): PlaylistVideoItem[] {
  const container = getPlaylistContainer();
  if (!container) return [];

  const renderers = qsa(SEL.videoItem, container);
  return renderers
    .map((el, index) => parseVideoRenderer(el, index))
    .filter((item): item is PlaylistVideoItem => item !== null);
}

/**
 * Parses a single ytd-playlist-video-renderer element into
 * a PlaylistVideoItem.
 */
function parseVideoRenderer(
  element: HTMLElement,
  fallbackIndex: number,
): PlaylistVideoItem | null {
  // Extract video ID from the title link href
  const titleLink = qs<HTMLAnchorElement>(SEL.videoTitleLink, element);
  if (!titleLink) return null;

  const videoId = extractVideoId(titleLink.href);
  if (!videoId) return null;

  // Extract playlist item ID from the element's data
  // YouTube stores this in the renderer's data — we'll map it via API later
  const playlistItemId = extractPlaylistItemId(element);

  // Title
  const title = titleLink.textContent?.trim() ?? "";

  // Channel name
  const channelEl = qs(SEL.channelName, element);
  const channelTitle = channelEl?.textContent?.trim() ?? "";

  // Duration
  const durationBadge = qs(SEL.durationBadge, element);
  const durationTextEl = durationBadge
    ? qs(SEL.durationText, durationBadge)
    : null;
  const durationText = durationTextEl?.textContent?.trim() ?? "0:00";
  const durationSeconds = parseDurationText(durationText);

  // Watch progress
  const { watchProgress, isFullyWatched } = parseWatchProgress(element);

  // Original index
  const indexEl = qs(SEL.indexBadge, element);
  const originalIndex = indexEl
    ? parseInt(indexEl.textContent?.trim() ?? "", 10) - 1
    : fallbackIndex;

  return {
    playlistItemId,
    videoId,
    title,
    channelTitle,
    durationSeconds,
    durationText,
    publishedAt: "",
    watchProgress,
    isFullyWatched,
    element,
    originalIndex: isNaN(originalIndex) ? fallbackIndex : originalIndex,
    metadataEnriched: false,
  };
}

/**
 * Extracts the video ID from a YouTube URL.
 * e.g. "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=..." -> "dQw4w9WgXcQ"
 */
function extractVideoId(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

/**
 * Attempts to extract the playlist item ID from the renderer element.
 * YouTube doesn't expose this directly in the DOM in a reliable way,
 * so we use a data attribute approach. If unavailable, we return an
 * empty string — the caller should map these via the API later.
 */
function extractPlaylistItemId(element: HTMLElement): string {
  // YouTube stores data in the element's __data property (Polymer)
  // This is a best-effort extraction; the API provides authoritative IDs
  const data = (element as unknown as Record<string, unknown>).__data as
    | { data?: { playlistItemId?: string; setVideoId?: string } }
    | undefined;

  return data?.data?.playlistItemId ?? data?.data?.setVideoId ?? "";
}

/**
 * Parses the watch progress from a video renderer element.
 *
 * IMPORTANT: Content scripts run in an isolated JavaScript world
 * and cannot access Polymer data properties on YouTube's custom
 * elements. This function returns default values (0 / false).
 *
 * Accurate watch progress data must be obtained separately via
 * the page bridge (see page-bridge.ts: enrichWatchProgress),
 * which injects a script into the page's main world to read
 * YouTube's internal percentDurationWatched property.
 *
 * Returns { watchProgress: 0, isFullyWatched: false } as defaults.
 * Call enrichWatchProgress(items) after parsing to populate real data.
 */
function parseWatchProgress(_element: HTMLElement): {
  watchProgress: number;
  isFullyWatched: boolean;
} {
  // Actual progress is populated later by enrichWatchProgress()
  return { watchProgress: 0, isFullyWatched: false };
}

// ─── Scroll Loading ──────────────────────────────────────────────

/**
 * Scrolls the playlist container to trigger YouTube's lazy loading
 * of all video items. Resolves when no new items appear after
 * consecutive scroll attempts.
 *
 * @param maxScrollAttempts - Maximum number of scroll attempts before giving up.
 * @param scrollDelayMs - Delay between scroll attempts to let YouTube load items.
 */
export async function scrollToLoadAll(
  maxScrollAttempts: number = 50,
  scrollDelayMs: number = 500,
): Promise<void> {
  const container = getPlaylistContainer();
  if (!container) return;

  let previousCount = 0;
  let unchangedAttempts = 0;
  const maxUnchanged = 3; // Give up after 3 scrolls with no new items

  for (let i = 0; i < maxScrollAttempts; i++) {
    // Scroll to the bottom of the playlist container
    const items = qsa(SEL.videoItem, container);
    const currentCount = items.length;

    if (currentCount === previousCount) {
      unchangedAttempts++;
      if (unchangedAttempts >= maxUnchanged) {
        // No new items loaded after several attempts — we're done
        break;
      }
    } else {
      unchangedAttempts = 0;
    }

    previousCount = currentCount;

    // Scroll the last item into view to trigger loading
    const lastItem = items[items.length - 1];
    if (lastItem) {
      lastItem.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    await sleep(scrollDelayMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Playlist Item ID Mapping ────────────────────────────────────

/**
 * Maps video IDs to playlist item IDs by fetching from the API.
 * This is needed because the DOM doesn't reliably expose
 * playlist item IDs, which are required for delete/update operations.
 *
 * Updates the provided PlaylistVideoItem array in place.
 */
export async function mapPlaylistItemIds(
  items: PlaylistVideoItem[],
  playlistId: string,
): Promise<void> {
  const apiItems = await listAllPlaylistItems(playlistId);

  // Build a map of videoId -> playlistItemId
  const idMap = new Map<string, string>();
  for (const apiItem of apiItems) {
    idMap.set(apiItem.contentDetails.videoId, apiItem.id);
  }

  // Update the DOM-parsed items with the API playlist item IDs
  for (const item of items) {
    const apiId = idMap.get(item.videoId);
    if (apiId) {
      item.playlistItemId = apiId;
    }
  }
}

// ─── Video Metadata Enrichment ────────────────────────────────────

/**
 * Enriches PlaylistVideoItems with accurate metadata from the
 * YouTube videos.list API:
 *   - publishedAt (when the video was uploaded)
 *   - durationSeconds (accurate ISO 8601 duration, not DOM-parsed text)
 *
 * Quota cost: 1 unit per 50 videos.
 *
 * Only fetches metadata for items not yet enriched (metadataEnriched === false).
 * Modifies items in place.
 */
export async function enrichVideoMetadata(
  items: PlaylistVideoItem[],
): Promise<void> {
  const needsEnrichment = items.filter((item) => !item.metadataEnriched);
  if (needsEnrichment.length === 0) return;

  const videoIds = needsEnrichment.map((item) => item.videoId);
  const videos = await getVideoDetails(videoIds);

  // Build lookup maps
  const publishedAtMap = new Map<string, string>();
  const durationMap = new Map<string, number>();

  for (const video of videos) {
    if (video.snippet?.publishedAt) {
      publishedAtMap.set(video.id, video.snippet.publishedAt);
    }
    if (video.contentDetails?.duration) {
      durationMap.set(
        video.id,
        parseISO8601Duration(video.contentDetails.duration),
      );
    }
  }

  // Patch items in place
  for (const item of needsEnrichment) {
    const published = publishedAtMap.get(item.videoId);
    if (published) {
      item.publishedAt = published;
    }

    const duration = durationMap.get(item.videoId);
    if (duration !== undefined) {
      item.durationSeconds = duration;
      item.durationText = formatDuration(duration);
    }

    item.metadataEnriched = true;
  }
}
