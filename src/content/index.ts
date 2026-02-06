/**
 * Content script entry point.
 * Injected into all youtube.com pages. Detects when the user
 * navigates to a playlist page and bootstraps the extension UI.
 *
 * YouTube is a Single Page Application (SPA), so we can't rely
 * on the content script only running once on page load. We listen
 * for YouTube's custom `yt-navigate-finish` event to detect
 * in-app navigation, and also handle the initial page load.
 */

import "../assets/styles.css";
import { isPlaylistPage } from "./services/playlist-dom";
import { resetState } from "./services/selection-state";
import { waitForElement } from "./utils/dom-helpers";
import {
  injectCheckbox,
  injectAllCheckboxes,
  removeAllCheckboxes,
  startCheckboxSync,
} from "./ui/checkbox";
import {
  injectToolbar,
  removeToolbar,
  loadPlaylistData,
  getToolbarRightSection,
} from "./ui/toolbar";
import {
  injectSortControls,
  removeSortControls,
} from "./ui/sort-controls";

/** Track whether we've already initialized for the current playlist. */
let currentPlaylistId: string | null = null;
let cleanupFn: (() => void) | null = null;

/**
 * Main initialization function. Called on page load and on
 * every SPA navigation within YouTube.
 */
async function onNavigate(): Promise<void> {
  const url = new URL(window.location.href);
  const playlistId = url.searchParams.get("list");

  // If we're not on a playlist page, tear down any existing UI
  if (!isPlaylistPage()) {
    teardown();
    return;
  }

  // If we're already initialized for this playlist, skip
  if (playlistId === currentPlaylistId) {
    return;
  }

  // Tear down previous instance if switching playlists
  teardown();

  currentPlaylistId = playlistId;

  // Wait for the playlist container to appear in the DOM
  const container = await waitForElement(
    "ytd-playlist-video-list-renderer",
    document,
    15000,
  );

  if (!container) {
    console.warn("[RF Playlist Manager] Playlist container not found");
    return;
  }

  // Double-check we're still on the same playlist after waiting
  if (currentPlaylistId !== playlistId) return;

  // Bootstrap the extension UI
  initialize(container, playlistId!);
}

/**
 * Bootstraps the extension UI: toolbar, checkboxes, etc.
 */
function initialize(container: HTMLElement, playlistId: string): void {
  console.log(
    `[RF Playlist Manager] Initializing for playlist: ${playlistId}`,
  );

  // Inject the toolbar above the playlist
  injectToolbar(container);

  // Inject Phase 4 + 5 controls into the toolbar's right section
  const rightSection = getToolbarRightSection();
  if (rightSection) {
    injectSortControls(rightSection);
  }

  // Inject checkboxes on all existing video items
  injectAllCheckboxes(container);

  // Start syncing checkbox visual state with selection state
  startCheckboxSync();

  // Set up a MutationObserver to detect when new video items are
  // lazily loaded into the playlist (for checkbox injection)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node instanceof HTMLElement &&
          node.tagName.toLowerCase() === "ytd-playlist-video-renderer"
        ) {
          // Extract video ID and inject checkbox on the new item
          const link = node.querySelector(
            "a#video-title",
          ) as HTMLAnchorElement | null;
          if (link) {
            try {
              const url = new URL(link.href, window.location.origin);
              const videoId = url.searchParams.get("v");
              if (videoId) {
                injectCheckbox(node, videoId);
              }
            } catch {
              // Ignore malformed URLs
            }
          }
        }
      }
    }
  });

  observer.observe(container, { childList: true, subtree: true });

  // Start loading playlist data (scroll, parse, map IDs) in the background
  loadPlaylistData(container, playlistId);

  // Store cleanup function
  cleanupFn = () => {
    observer.disconnect();
    removeSortControls();
    removeToolbar();
    removeAllCheckboxes();
    resetState();
    console.log("[RF Playlist Manager] Cleaned up");
  };
}

/**
 * Tears down the extension UI and resets state.
 */
function teardown(): void {
  if (cleanupFn) {
    cleanupFn();
    cleanupFn = null;
  }
  currentPlaylistId = null;
}

// ─── Event Listeners ──────────────────────────────────────────────

// YouTube fires this custom event on SPA navigation
document.addEventListener("yt-navigate-finish", () => {
  onNavigate();
});

// Also handle the initial page load
// (content script may be injected after the page has already navigated)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => onNavigate());
} else {
  onNavigate();
}
