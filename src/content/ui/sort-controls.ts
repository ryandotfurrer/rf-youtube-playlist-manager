/**
 * Multi-level sort controls for reordering playlist videos.
 *
 * Supports sorting by:
 *   - Duration (shortest/longest first)
 *   - Date published (newest/oldest first)
 *
 * Users can add up to 2 sort levels (e.g. date published asc,
 * then duration asc).
 *
 * Hybrid reordering:
 *   - Playlists <= 100 videos: option to persist via YouTube API
 *   - Playlists > 100 videos: client-side DOM reorder only
 *
 * Injected into the toolbar's right section.
 */

import { createElement } from "../utils/dom-helpers";
import { getAllItems } from "../services/selection-state";
import {
  getPlaylistContainer,
  getPlaylistIdFromUrl,
  enrichVideoMetadata,
} from "../services/playlist-dom";
import { reorderPlaylist } from "../services/youtube-api";
import { showToast, ensureAllLoaded } from "./toolbar";
import { setAllItems } from "../services/selection-state";
import type {
  SortField,
  SortLevel,
  PlaylistVideoItem,
} from "../../types/youtube";
import { API_SORT_THRESHOLD } from "../../types/youtube";

const PREFIX = "rfpm";
const MAX_SORT_LEVELS = 2;

const FIELD_LABELS: Record<SortField, string> = {
  duration: "Duration",
  published: "Date Published",
};

const DIR_LABELS: Record<"asc" | "desc", Record<SortField, string>> = {
  asc: {
    duration: "Shortest first",
    published: "Oldest first",
  },
  desc: {
    duration: "Longest first",
    published: "Newest first",
  },
};

let groupElement: HTMLElement | null = null;
let popoverElement: HTMLElement | null = null;
let closeHandler: ((e: MouseEvent) => void) | null = null;
let sortLevels: SortLevel[] = [{ field: "published", direction: "asc" }];

// ─── Lifecycle ────────────────────────────────────────────────────

/**
 * Creates the sort button and appends it to the given parent.
 */
export function injectSortControls(parent: HTMLElement): void {
  removeSortControls();

  const group = createElement("div", {
    class: `${PREFIX}-sort-group`,
  });

  const triggerBtn = createElement(
    "button",
    {
      class: `${PREFIX}-btn ${PREFIX}-btn-sort`,
      title: "Sort playlist videos",
    },
    "Sort",
  );

  triggerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopover(group);
  });

  group.appendChild(triggerBtn);
  parent.appendChild(group);
  groupElement = group;
}

/**
 * Removes the sort controls and cleans up.
 */
export function removeSortControls(): void {
  closePopover();
  if (groupElement) {
    groupElement.remove();
    groupElement = null;
  }
  sortLevels = [{ field: "published", direction: "asc" }];
}

// ─── Popover ──────────────────────────────────────────────────────

function togglePopover(parent: HTMLElement): void {
  if (popoverElement) {
    closePopover();
    return;
  }

  const popover = createElement("div", {
    class: `${PREFIX}-dropdown ${PREFIX}-sort-popover`,
  });

  renderPopoverContent(popover);

  parent.appendChild(popover);
  popoverElement = popover;

  closeHandler = (e: MouseEvent) => {
    if (!parent.contains(e.target as Node)) {
      closePopover();
    }
  };
  setTimeout(() => {
    document.addEventListener("click", closeHandler!);
  }, 0);
}

function closePopover(): void {
  if (popoverElement) {
    popoverElement.remove();
    popoverElement = null;
  }
  if (closeHandler) {
    document.removeEventListener("click", closeHandler);
    closeHandler = null;
  }
}

function renderPopoverContent(popover: HTMLElement): void {
  popover.innerHTML = "";

  // Title
  const title = createElement(
    "div",
    { class: `${PREFIX}-sort-popover-title` },
    "Sort Playlist",
  );
  popover.appendChild(title);

  // Sort levels
  const levelsContainer = createElement("div", {
    class: `${PREFIX}-sort-levels`,
  });

  for (let i = 0; i < sortLevels.length; i++) {
    levelsContainer.appendChild(renderSortLevel(i, popover));
  }

  popover.appendChild(levelsContainer);

  // Add level button (if under max)
  if (sortLevels.length < MAX_SORT_LEVELS) {
    const addBtn = createElement(
      "button",
      { class: `${PREFIX}-btn ${PREFIX}-btn-sort ${PREFIX}-sort-add-btn` },
      "+ Add sort level",
    );
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Pick the first field not already used
      const usedFields = new Set(sortLevels.map((l) => l.field));
      const availableField: SortField = usedFields.has("published")
        ? "duration"
        : "published";
      sortLevels.push({ field: availableField, direction: "asc" });
      renderPopoverContent(popover);
    });
    popover.appendChild(addBtn);
  }

  // Mode indicator
  const allItems = getAllItems();
  const itemCount = allItems.length;
  const mode = itemCount <= API_SORT_THRESHOLD ? "api" : "visual";
  const modeLabel =
    mode === "api"
      ? `Persistent sort (${itemCount} videos, ${itemCount * 50} quota units)`
      : `Visual sort only (${itemCount} videos exceeds ${API_SORT_THRESHOLD} limit)`;

  const modeIndicator = createElement(
    "div",
    { class: `${PREFIX}-sort-mode` },
    modeLabel,
  );
  popover.appendChild(modeIndicator);

  // Action buttons
  const actions = createElement("div", {
    class: `${PREFIX}-sort-actions`,
  });

  const applyBtn = createElement(
    "button",
    { class: `${PREFIX}-btn ${PREFIX}-btn-action` },
    "Apply Sort",
  );
  applyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closePopover();
    handleApplySort();
  });

  const resetBtn = createElement(
    "button",
    { class: `${PREFIX}-btn ${PREFIX}-btn-sort` },
    "Reset to Original",
  );
  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closePopover();
    handleResetSort();
  });

  actions.appendChild(applyBtn);
  actions.appendChild(resetBtn);
  popover.appendChild(actions);
}

function renderSortLevel(index: number, popover: HTMLElement): HTMLElement {
  const level = sortLevels[index];

  const row = createElement("div", { class: `${PREFIX}-sort-level-row` });

  // Label
  const label = createElement(
    "span",
    { class: `${PREFIX}-sort-level-label` },
    index === 0 ? "Sort by" : "Then by",
  );

  // Field select
  const fieldSelect = createElement("select", {
    class: `${PREFIX}-sort-select`,
  }) as HTMLSelectElement;

  const fields: SortField[] = ["published", "duration"];
  for (const field of fields) {
    const option = createElement("option", { value: field }, FIELD_LABELS[field]);
    if (field === level.field) {
      (option as HTMLOptionElement).selected = true;
    }
    fieldSelect.appendChild(option);
  }

  fieldSelect.addEventListener("change", (e) => {
    e.stopPropagation();
    sortLevels[index].field = fieldSelect.value as SortField;
    renderPopoverContent(popover);
  });

  // Direction toggle button
  const dirBtn = createElement(
    "button",
    {
      class: `${PREFIX}-btn ${PREFIX}-btn-sort ${PREFIX}-sort-dir-btn`,
      title: "Toggle sort direction",
    },
    DIR_LABELS[level.direction][level.field],
  );

  dirBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sortLevels[index].direction =
      sortLevels[index].direction === "asc" ? "desc" : "asc";
    renderPopoverContent(popover);
  });

  row.appendChild(label);
  row.appendChild(fieldSelect);
  row.appendChild(dirBtn);

  // Remove button (only if more than 1 level)
  if (sortLevels.length > 1) {
    const removeBtn = createElement(
      "button",
      {
        class: `${PREFIX}-btn ${PREFIX}-sort-remove-btn`,
        title: "Remove this sort level",
      },
      "x",
    );
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sortLevels.splice(index, 1);
      renderPopoverContent(popover);
    });
    row.appendChild(removeBtn);
  }

  return row;
}

// ─── Sort Execution ───────────────────────────────────────────────

async function handleApplySort(): Promise<void> {
  const playlistId = getPlaylistIdFromUrl();
  if (!playlistId) return;

  const allItems = getAllItems();
  if (allItems.length === 0) {
    showToast("No videos loaded.");
    return;
  }

  // Ensure all items are loaded with IDs
  await ensureAllLoaded(playlistId);

  // Enrich metadata (publishedAt, accurate duration) if not done.
  // Check actual items rather than a flag, since ensureAllLoaded
  // may have replaced the items array with fresh un-enriched ones.
  const currentItems = getAllItems();
  const needsEnrichment = currentItems.some((item) => !item.metadataEnriched);
  if (needsEnrichment) {
    showToast("Loading video metadata...");
    try {
      await enrichVideoMetadata(currentItems);
    } catch (err) {
      showToast("Failed to load video metadata. Try again.");
      console.error("[RF Playlist Manager] metadata enrichment failed:", err);
      return;
    }
  }

  const items = getAllItems();

  // Debug: log a sample item to verify metadata is populated
  if (items.length > 0) {
    const sample = items[0];
    console.log("[RF Playlist Manager] Sort sample item:", {
      title: sample.title,
      publishedAt: sample.publishedAt,
      durationSeconds: sample.durationSeconds,
      metadataEnriched: sample.metadataEnriched,
    });
  }

  // Build sorted copy
  const sorted = [...items].sort(buildComparator(sortLevels));

  const mode = items.length <= API_SORT_THRESHOLD ? "api" : "visual";

  if (mode === "api") {
    // Check all items have playlistItemIds
    const missingIds = sorted.filter((item) => !item.playlistItemId);
    if (missingIds.length > 0) {
      showToast(
        "Some videos are missing playlist IDs. Try refreshing the page.",
      );
      return;
    }

    const quotaCost = sorted.length * 50;
    const confirmed = confirm(
      `Sort ${sorted.length} videos and save the new order to YouTube?\n\n` +
        `This will permanently reorder your playlist.\n` +
        `Quota cost: ${quotaCost.toLocaleString()} of 10,000 daily units.\n\n` +
        `Cancel to sort visually only (no API calls).`,
    );

    if (confirmed) {
      // API-based persistent reorder
      showToast("Reordering playlist...");
      const reorderItems = sorted.map((item) => ({
        playlistItemId: item.playlistItemId,
        videoId: item.videoId,
      }));

      const result = await reorderPlaylist(
        reorderItems,
        playlistId,
        (completed, total) => {
          showToast(`Reordering... ${completed}/${total}`);
        },
      );

      if (result.failed.length > 0) {
        showToast(
          `Sorted ${result.succeeded}, ${result.failed.length} failed. Refresh to see final order.`,
        );
      } else {
        showToast(`Playlist sorted and saved (${result.succeeded} videos)`);
      }

      // Also reorder the DOM to match
      reorderDOM(sorted);
      return;
    }

    // User cancelled API sort — fall through to visual-only
  }

  // Visual-only DOM reorder
  reorderDOM(sorted);
  showToast(`Sorted ${sorted.length} videos (visual only, not saved)`);
}

function handleResetSort(): void {
  const items = getAllItems();
  if (items.length === 0) return;

  const original = [...items].sort((a, b) => a.originalIndex - b.originalIndex);
  reorderDOM(original);
  showToast("Restored original order");
}

/**
 * Truncates a Date to midnight UTC, returning the epoch ms.
 * This ensures two timestamps from the same calendar day
 * are treated as equal for sorting purposes.
 */
function truncateToDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Builds a multi-level comparator from the sort levels.
 */
function buildComparator(
  levels: SortLevel[],
): (a: PlaylistVideoItem, b: PlaylistVideoItem) => number {
  return (a, b) => {
    for (const level of levels) {
      let cmp = 0;

      switch (level.field) {
        case "duration":
          cmp = (a.durationSeconds || 0) - (b.durationSeconds || 0);
          break;
        case "published": {
          // Compare by calendar date only (truncate to midnight UTC)
          // so that videos from the same day are treated as ties,
          // allowing the next sort level to break them.
          const dateA = a.publishedAt
            ? truncateToDay(new Date(a.publishedAt))
            : 0;
          const dateB = b.publishedAt
            ? truncateToDay(new Date(b.publishedAt))
            : 0;
          const safeA = isNaN(dateA) ? 0 : dateA;
          const safeB = isNaN(dateB) ? 0 : dateB;
          cmp = safeA - safeB;
          break;
        }
      }

      if (level.direction === "desc") {
        cmp = -cmp;
      }

      // Only move to next level if this level is a tie
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
}

/**
 * Reorders DOM elements to match the given item order.
 */
function reorderDOM(items: PlaylistVideoItem[]): void {
  const container = getPlaylistContainer();
  if (!container) return;

  // Find the direct parent of the renderers
  const contents = container.querySelector("#contents") as HTMLElement | null;
  const rendererParent = contents ?? container;

  // Verify it has renderers
  const firstRenderer = rendererParent.querySelector(
    "ytd-playlist-video-renderer",
  );
  if (!firstRenderer) return;

  const parent =
    firstRenderer.parentElement === rendererParent
      ? rendererParent
      : firstRenderer.parentElement;
  if (!parent) return;

  for (const item of items) {
    parent.appendChild(item.element);
  }
}
