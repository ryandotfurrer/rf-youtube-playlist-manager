/**
 * Selection state manager.
 * Tracks which videos are currently selected in the playlist
 * and notifies listeners on changes.
 */

import type { PlaylistVideoItem } from "../../types/youtube";

type SelectionChangeCallback = (
  selectedItems: PlaylistVideoItem[],
  allItems: PlaylistVideoItem[],
) => void;

/** The full list of parsed video items in the current playlist. */
let allItems: PlaylistVideoItem[] = [];

/** Set of currently selected video IDs. */
const selectedIds = new Set<string>();

/** Listeners notified when selection changes. */
const listeners: SelectionChangeCallback[] = [];

// ─── Public API ───────────────────────────────────────────────────

/**
 * Replaces the full list of known video items.
 * Called after parsing the DOM or after lazy-load updates.
 */
export function setAllItems(items: PlaylistVideoItem[]): void {
  allItems = items;
  // Remove any selected IDs that no longer exist
  for (const id of selectedIds) {
    if (!items.some((item) => item.videoId === id)) {
      selectedIds.delete(id);
    }
  }
  notifyListeners();
}

/**
 * Returns the full list of known video items.
 */
export function getAllItems(): PlaylistVideoItem[] {
  return allItems;
}

/**
 * Toggles the selection state of a single video.
 */
export function toggleSelection(videoId: string): void {
  if (selectedIds.has(videoId)) {
    selectedIds.delete(videoId);
  } else {
    selectedIds.add(videoId);
  }
  notifyListeners();
}

/**
 * Sets the selection state of a single video.
 */
export function setSelected(videoId: string, selected: boolean): void {
  if (selected) {
    selectedIds.add(videoId);
  } else {
    selectedIds.delete(videoId);
  }
  notifyListeners();
}

/**
 * Returns whether a video is currently selected.
 */
export function isSelected(videoId: string): boolean {
  return selectedIds.has(videoId);
}

/**
 * Selects all videos.
 */
export function selectAll(): void {
  for (const item of allItems) {
    selectedIds.add(item.videoId);
  }
  notifyListeners();
}

/**
 * Deselects all videos.
 */
export function deselectAll(): void {
  selectedIds.clear();
  notifyListeners();
}

/**
 * Returns the currently selected video items.
 */
export function getSelectedItems(): PlaylistVideoItem[] {
  return allItems.filter((item) => selectedIds.has(item.videoId));
}

/**
 * Returns the number of selected videos.
 */
export function getSelectedCount(): number {
  return selectedIds.size;
}

/**
 * Returns true if all items are selected.
 */
export function isAllSelected(): boolean {
  return allItems.length > 0 && selectedIds.size === allItems.length;
}

/**
 * Registers a callback that fires whenever the selection changes.
 * Returns an unsubscribe function.
 */
export function onSelectionChange(
  callback: SelectionChangeCallback,
): () => void {
  listeners.push(callback);
  return () => {
    const index = listeners.indexOf(callback);
    if (index !== -1) listeners.splice(index, 1);
  };
}

/**
 * Clears all state. Called during teardown.
 */
export function resetState(): void {
  allItems = [];
  selectedIds.clear();
  listeners.length = 0;
}

// ─── Internal ─────────────────────────────────────────────────────

function notifyListeners(): void {
  const selected = getSelectedItems();
  for (const listener of listeners) {
    listener(selected, allItems);
  }
}
