/**
 * Main toolbar injected above the playlist video list.
 * Contains:
 *   - Select All / Deselect All toggle
 *   - Selection count indicator
 *   - Bulk action buttons (shown when 1+ videos selected):
 *     - Add to Queue
 *     - Move to Playlist (with create-new-playlist option)
 *     - Remove from Playlist
 *   - Slots for Sort controls
 */

import { createElement } from "../utils/dom-helpers";
import {
  selectAll,
  deselectAll,
  isAllSelected,
  getSelectedCount,
  getSelectedItems,
  onSelectionChange,
  getAllItems,
} from "../services/selection-state";
import {
  parseVideoItems,
  mapPlaylistItemIds,
  getPlaylistIdFromUrl,
  scrollToLoadAll,
} from "../services/playlist-dom";
import { setAllItems } from "../services/selection-state";
import {
  deletePlaylistItems,
  insertPlaylistItems,
  listAllMyPlaylists,
  createPlaylist,
} from "../services/youtube-api";
import type { PlaylistVideoItem, YouTubePlaylist } from "../../types/youtube";

const PREFIX = "rfpm";

let toolbarElement: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;

// ─── Toolbar Lifecycle ────────────────────────────────────────────

/**
 * Creates and injects the toolbar above the playlist container.
 * Returns the toolbar element.
 */
export function injectToolbar(container: HTMLElement): HTMLElement {
  // Remove any existing toolbar
  removeToolbar();

  const toolbar = createElement("div", { class: `${PREFIX}-toolbar` });

  // ── Left section: Select All + count ──
  const leftSection = createElement("div", {
    class: `${PREFIX}-toolbar-left`,
  });

  const selectAllBtn = createElement(
    "button",
    {
      class: `${PREFIX}-btn ${PREFIX}-btn-select-all`,
      title: "Select All",
    },
    "Select All",
  );
  selectAllBtn.addEventListener("click", handleSelectAllToggle);

  const countLabel = createElement(
    "span",
    { class: `${PREFIX}-selection-count` },
    "",
  );

  leftSection.appendChild(selectAllBtn);
  leftSection.appendChild(countLabel);

  // ── Center section: Bulk actions ──
  const centerSection = createElement("div", {
    class: `${PREFIX}-toolbar-center`,
  });

  const addToQueueBtn = createElement(
    "button",
    {
      class: `${PREFIX}-btn ${PREFIX}-btn-action`,
      title: "Add selected videos to queue",
      "data-action": "queue",
    },
    "Add to Queue",
  );
  addToQueueBtn.addEventListener("click", handleAddToQueue);

  const moveToPlaylistBtn = createElement(
    "button",
    {
      class: `${PREFIX}-btn ${PREFIX}-btn-action`,
      title: "Move selected videos to a different playlist",
      "data-action": "move",
    },
    "Move to Playlist",
  );
  moveToPlaylistBtn.addEventListener("click", handleMoveToPlaylist);

  const removeBtn = createElement(
    "button",
    {
      class: `${PREFIX}-btn ${PREFIX}-btn-action ${PREFIX}-btn-danger`,
      title: "Remove selected videos from this playlist",
      "data-action": "remove",
    },
    "Remove from Playlist",
  );
  removeBtn.addEventListener("click", handleRemoveFromPlaylist);

  centerSection.appendChild(addToQueueBtn);
  centerSection.appendChild(moveToPlaylistBtn);
  centerSection.appendChild(removeBtn);

  // ── Right section: Placeholder for Phase 4/5 controls ──
  const rightSection = createElement("div", {
    class: `${PREFIX}-toolbar-right`,
    id: `${PREFIX}-toolbar-right`,
  });

  toolbar.appendChild(leftSection);
  toolbar.appendChild(centerSection);
  toolbar.appendChild(rightSection);

  // Insert before the playlist container
  container.parentElement?.insertBefore(toolbar, container);

  toolbarElement = toolbar;

  // Listen for selection changes to update the toolbar
  unsubscribe = onSelectionChange(updateToolbarState);
  updateToolbarState([], getAllItems());

  return toolbar;
}

/**
 * Removes the toolbar from the DOM and cleans up listeners.
 */
export function removeToolbar(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (toolbarElement) {
    toolbarElement.remove();
    toolbarElement = null;
  }
}

/**
 * Returns the toolbar's right section element, where Phase 4/5
 * controls can be appended.
 */
export function getToolbarRightSection(): HTMLElement | null {
  return toolbarElement?.querySelector(`#${PREFIX}-toolbar-right`) ?? null;
}

// ─── Toolbar State Updates ────────────────────────────────────────

function updateToolbarState(
  _selected: PlaylistVideoItem[],
  _all: PlaylistVideoItem[],
): void {
  if (!toolbarElement) return;

  const count = getSelectedCount();
  const allSelected = isAllSelected();

  // Update select all button text
  const selectAllBtn = toolbarElement.querySelector(
    `.${PREFIX}-btn-select-all`,
  );
  if (selectAllBtn) {
    selectAllBtn.textContent = allSelected ? "Deselect All" : "Select All";
  }

  // Update count label
  const countLabel = toolbarElement.querySelector(
    `.${PREFIX}-selection-count`,
  );
  if (countLabel) {
    countLabel.textContent =
      count > 0 ? `${count} video${count !== 1 ? "s" : ""} selected` : "";
  }

  // Show/hide bulk action buttons
  const actionButtons = toolbarElement.querySelectorAll(
    `.${PREFIX}-btn-action`,
  );
  for (const btn of actionButtons) {
    (btn as HTMLElement).style.display = count > 0 ? "" : "none";
  }
}

// ─── Action Handlers ──────────────────────────────────────────────

function handleSelectAllToggle(): void {
  if (isAllSelected()) {
    deselectAll();
  } else {
    selectAll();
  }
}

/**
 * Add to Queue: Simulates clicking YouTube's "Add to queue" for
 * each selected video via the context menu.
 */
async function handleAddToQueue(): Promise<void> {
  const selected = getSelectedItems();
  if (selected.length === 0) return;

  const confirmed = confirm(
    `Add ${selected.length} video${selected.length !== 1 ? "s" : ""} to queue?`,
  );
  if (!confirmed) return;

  let addedCount = 0;

  for (const item of selected) {
    try {
      await simulateAddToQueue(item.element);
      addedCount++;
    } catch (err) {
      console.warn(
        `[RF Playlist Manager] Failed to queue "${item.title}":`,
        err,
      );
    }
  }

  showToast(`Added ${addedCount} video${addedCount !== 1 ? "s" : ""} to queue`);
  deselectAll();
}

/**
 * Move to Playlist: Opens a playlist picker (with option to create
 * a new playlist), inserts selected videos into the target playlist,
 * then removes them from the current playlist.
 */
async function handleMoveToPlaylist(): Promise<void> {
  const selected = getSelectedItems();
  if (selected.length === 0) return;

  const currentPlaylistId = getPlaylistIdFromUrl();
  if (!currentPlaylistId) return;

  // Fetch user's playlists
  showToast("Loading your playlists...");
  let playlists: YouTubePlaylist[];
  try {
    playlists = await listAllMyPlaylists();
  } catch (err) {
    showToast("Failed to load playlists. Please try again.");
    console.error("[RF Playlist Manager] Failed to load playlists:", err);
    return;
  }

  // Filter out the current playlist
  const otherPlaylists = playlists.filter((p) => p.id !== currentPlaylistId);

  // Show playlist picker (includes "Create New Playlist" option)
  const targetPlaylist = await showPlaylistPicker(otherPlaylists);
  if (!targetPlaylist) return;

  // Ensure we have playlist item IDs for deletion from current playlist
  const needsMapping = selected.some((item) => !item.playlistItemId);
  if (needsMapping) {
    await ensureAllLoaded(currentPlaylistId);
  }

  // Re-read selected items after potential mapping
  const itemsToMove = getSelectedItems().filter(
    (item) => item.playlistItemId,
  );

  if (itemsToMove.length === 0) {
    showToast("Could not resolve playlist item IDs. Try refreshing the page.");
    return;
  }

  // Quota warning: insert + delete
  const insertCost = itemsToMove.length * 50;
  const deleteCost = itemsToMove.length * 50;
  const totalCost = insertCost + deleteCost;
  const confirmed = confirm(
    `Move ${itemsToMove.length} video${itemsToMove.length !== 1 ? "s" : ""} to "${targetPlaylist.snippet.title}"?\n\n` +
      `Videos will be added to the target playlist and removed from this one.\n` +
      `Quota cost: ${totalCost.toLocaleString()} of 10,000 daily units.`,
  );
  if (!confirmed) return;

  // Step 1: Insert videos into target playlist
  const videoIds = itemsToMove.map((item) => item.videoId);
  const insertResult = await insertPlaylistItems(
    targetPlaylist.id,
    videoIds,
    (completed, total) => {
      showToast(`Moving... adding ${completed}/${total}`);
    },
  );

  if (insertResult.succeeded.length === 0) {
    showToast("Failed to add videos to target playlist.");
    return;
  }

  // Step 2: Delete successfully inserted videos from current playlist
  const succeededVideoIds = new Set(insertResult.succeeded);
  const itemsToDelete = itemsToMove.filter((item) =>
    succeededVideoIds.has(item.videoId),
  );
  const playlistItemIds = itemsToDelete.map((item) => item.playlistItemId);

  const deleteResult = await deletePlaylistItems(
    playlistItemIds,
    (completed, total) => {
      showToast(`Moving... removing ${completed}/${total}`);
    },
  );

  // Remove deleted items from the DOM
  for (const item of itemsToDelete) {
    if (deleteResult.succeeded.includes(item.playlistItemId)) {
      item.element.remove();
    }
  }

  // Re-parse and update state
  const remaining = parseVideoItems();
  setAllItems(remaining);

  const movedCount = deleteResult.succeeded.length;
  const failedInserts = insertResult.failed.length;
  const failedDeletes = deleteResult.failed.length;

  let msg: string;
  if (failedInserts === 0 && failedDeletes === 0) {
    msg = `Moved ${movedCount} video${movedCount !== 1 ? "s" : ""} to "${targetPlaylist.snippet.title}"`;
  } else {
    const parts: string[] = [`Moved ${movedCount}`];
    if (failedInserts > 0) parts.push(`${failedInserts} failed to add`);
    if (failedDeletes > 0) parts.push(`${failedDeletes} failed to remove`);
    msg = parts.join(", ");
  }

  showToast(msg);
  deselectAll();
}

/**
 * Remove from Playlist: Uses the API to delete selected videos
 * from the current playlist.
 */
async function handleRemoveFromPlaylist(): Promise<void> {
  const selected = getSelectedItems();
  if (selected.length === 0) return;

  const playlistId = getPlaylistIdFromUrl();
  if (!playlistId) return;

  // Ensure we have playlist item IDs (needed for the API)
  const needsMapping = selected.some((item) => !item.playlistItemId);
  if (needsMapping) {
    await ensureAllLoaded(playlistId);
  }

  // Re-read selected items after mapping
  const itemsToRemove = getSelectedItems().filter(
    (item) => item.playlistItemId,
  );

  if (itemsToRemove.length === 0) {
    showToast("Could not resolve playlist item IDs. Try refreshing the page.");
    return;
  }

  // Quota warning
  const quotaCost = itemsToRemove.length * 50;
  const confirmed = confirm(
    `Remove ${itemsToRemove.length} video${itemsToRemove.length !== 1 ? "s" : ""} from this playlist?\n\n` +
      `This will use ${quotaCost} of your 10,000 daily API quota units.\n` +
      `This action cannot be undone.`,
  );
  if (!confirmed) return;

  showToast(`Removing videos...`);
  const playlistItemIds = itemsToRemove.map((item) => item.playlistItemId);
  const result = await deletePlaylistItems(
    playlistItemIds,
    (completed, total) => {
      showToast(`Removing... ${completed}/${total}`);
    },
  );

  // Remove the deleted items from the DOM
  for (const item of itemsToRemove) {
    if (result.succeeded.includes(item.playlistItemId)) {
      item.element.remove();
    }
  }

  // Re-parse and update state
  const remaining = parseVideoItems();
  setAllItems(remaining);

  const msg =
    result.failed.length > 0
      ? `Removed ${result.succeeded.length}, failed ${result.failed.length}`
      : `Removed ${result.succeeded.length} video${result.succeeded.length !== 1 ? "s" : ""}`;
  showToast(msg);
  deselectAll();
}

// ─── Add to Queue Simulation ──────────────────────────────────────

/**
 * Simulates adding a video to the queue by triggering YouTube's
 * own context menu "Add to queue" option.
 */
async function simulateAddToQueue(renderer: HTMLElement): Promise<void> {
  // Find the three-dot menu button on the video renderer
  const menuBtn = renderer.querySelector(
    "button.yt-icon-button, ytd-menu-renderer yt-button-shape button, " +
    "ytd-menu-renderer yt-icon-button",
  ) as HTMLElement | null;

  if (!menuBtn) {
    throw new Error("Menu button not found on renderer");
  }

  // Click the menu to open it
  menuBtn.click();

  // Wait for the popup menu to appear
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Find "Add to queue" in the popup menu items
  const menuItems = document.querySelectorAll(
    "ytd-menu-service-item-renderer, tp-yt-paper-item",
  );
  let queueItem: HTMLElement | null = null;

  for (const item of menuItems) {
    const text = item.textContent?.trim().toLowerCase();
    if (text?.includes("add to queue")) {
      queueItem = item as HTMLElement;
      break;
    }
  }

  if (queueItem) {
    queueItem.click();
  } else {
    // Close the menu if we couldn't find the option
    document.body.click();
    throw new Error('"Add to queue" option not found in menu');
  }

  // Small delay between queue operations
  await new Promise((resolve) => setTimeout(resolve, 200));
}

// ─── Playlist Picker ──────────────────────────────────────────────

/**
 * Shows a playlist picker dialog with:
 *   - "Create New Playlist" section at the top (name input + privacy dropdown)
 *   - List of existing playlists below
 * Returns the selected or newly created playlist, or null if cancelled.
 */
function showPlaylistPicker(
  playlists: YouTubePlaylist[],
): Promise<YouTubePlaylist | null> {
  return new Promise((resolve) => {
    const overlay = createElement("div", { class: `${PREFIX}-overlay` });
    const dialog = createElement("div", { class: `${PREFIX}-dialog` });

    const title = createElement(
      "h3",
      { class: `${PREFIX}-dialog-title` },
      "Move to Playlist",
    );

    // ── Create New Playlist section ──
    const createSection = createElement("div", {
      class: `${PREFIX}-create-playlist`,
    });

    const createTitle = createElement(
      "div",
      { class: `${PREFIX}-create-playlist-title` },
      "Create New Playlist",
    );

    const nameInput = createElement("input", {
      type: "text",
      class: `${PREFIX}-create-playlist-input`,
      placeholder: "Playlist name",
    }) as HTMLInputElement;

    const privacySelect = createElement("select", {
      class: `${PREFIX}-create-playlist-select`,
    }) as HTMLSelectElement;

    const privacyOptions: Array<{
      value: string;
      label: string;
    }> = [
      { value: "private", label: "Private" },
      { value: "unlisted", label: "Unlisted" },
      { value: "public", label: "Public" },
    ];

    for (const opt of privacyOptions) {
      const option = createElement("option", { value: opt.value }, opt.label);
      privacySelect.appendChild(option);
    }

    const createBtn = createElement(
      "button",
      { class: `${PREFIX}-btn ${PREFIX}-btn-action ${PREFIX}-create-playlist-btn` },
      "Create",
    );

    const createError = createElement("div", {
      class: `${PREFIX}-create-playlist-error`,
    });

    createBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) {
        createError.textContent = "Please enter a playlist name.";
        return;
      }

      createError.textContent = "";
      createBtn.textContent = "Creating...";
      (createBtn as HTMLButtonElement).disabled = true;

      try {
        const privacy = privacySelect.value as
          | "public"
          | "unlisted"
          | "private";
        const newPlaylist = await createPlaylist(name, privacy);
        cleanup();
        resolve(newPlaylist);
      } catch (err) {
        createError.textContent = "Failed to create playlist. Try again.";
        console.error("[RF Playlist Manager] Failed to create playlist:", err);
        createBtn.textContent = "Create";
        (createBtn as HTMLButtonElement).disabled = false;
      }
    });

    // Submit on Enter in the name input
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createBtn.click();
      }
    });

    const createRow = createElement("div", {
      class: `${PREFIX}-create-playlist-row`,
    });
    createRow.appendChild(nameInput);
    createRow.appendChild(privacySelect);
    createRow.appendChild(createBtn);

    createSection.appendChild(createTitle);
    createSection.appendChild(createRow);
    createSection.appendChild(createError);

    // ── Divider ──
    const divider = createElement("div", {
      class: `${PREFIX}-picker-divider`,
    });
    divider.textContent = "Or choose an existing playlist";

    // ── Existing playlist list ──
    const list = createElement("div", { class: `${PREFIX}-playlist-list` });

    if (playlists.length === 0) {
      const emptyMsg = createElement(
        "div",
        { class: `${PREFIX}-playlist-empty` },
        "No other playlists found.",
      );
      list.appendChild(emptyMsg);
    } else {
      for (const playlist of playlists) {
        const item = createElement(
          "button",
          {
            class: `${PREFIX}-playlist-item`,
            "data-playlist-id": playlist.id,
          },
          `${playlist.snippet.title} (${playlist.contentDetails.itemCount} videos)`,
        );

        item.addEventListener("click", () => {
          cleanup();
          resolve(playlist);
        });

        list.appendChild(item);
      }
    }

    // ── Cancel button ──
    const cancelBtn = createElement(
      "button",
      { class: `${PREFIX}-btn ${PREFIX}-btn-cancel` },
      "Cancel",
    );
    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });

    dialog.appendChild(title);
    dialog.appendChild(createSection);
    dialog.appendChild(divider);
    dialog.appendChild(list);
    dialog.appendChild(cancelBtn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Focus the name input
    setTimeout(() => nameInput.focus(), 50);

    function cleanup(): void {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    }

    // Close on overlay click (outside dialog)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    });

    // Close on Escape
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
        resolve(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
  });
}

// ─── Toast Notification ───────────────────────────────────────────

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Shows a brief toast notification at the bottom of the page.
 */
export function showToast(message: string, durationMs: number = 3000): void {
  let toast = document.querySelector(`.${PREFIX}-toast`) as HTMLElement | null;

  if (!toast) {
    toast = createElement("div", { class: `${PREFIX}-toast` });
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add(`${PREFIX}-toast-visible`);

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast?.classList.remove(`${PREFIX}-toast-visible`);
  }, durationMs);
}

// ─── Initial Data Load ────────────────────────────────────────────

/**
 * Parses the currently visible playlist items from the DOM
 * and sets them as the known items. Does NOT scroll or call the API.
 * Called once during initialization for a fast, non-intrusive start.
 */
export async function loadPlaylistData(
  _container: HTMLElement,
  _playlistId: string,
): Promise<void> {
  // Parse only the video items already visible in the DOM
  const items = parseVideoItems();
  setAllItems(items);

  if (items.length > 0) {
    showToast(`Found ${items.length} videos`);
  }
}

/**
 * Ensures all playlist items are loaded by scrolling the page,
 * re-parsing the DOM, and mapping playlist item IDs from the API.
 *
 * Call this lazily before any action that needs the full playlist
 * (e.g. remove watched, bulk remove). Shows progress toasts.
 */
export async function ensureAllLoaded(
  playlistId: string,
): Promise<void> {
  showToast("Loading all playlist items...");

  // Scroll to trigger YouTube's lazy loading
  await scrollToLoadAll();

  // Re-parse all video items from the DOM
  const items = parseVideoItems();
  setAllItems(items);

  // Map playlist item IDs from the API
  try {
    await mapPlaylistItemIds(items, playlistId);
    showToast(`Loaded ${items.length} videos`);
  } catch (err) {
    console.warn(
      "[RF Playlist Manager] Failed to map playlist item IDs:",
      err,
    );
    showToast(
      `Loaded ${items.length} videos (some features may be limited without sign-in)`,
    );
  }
}
