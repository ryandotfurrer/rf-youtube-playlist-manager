/**
 * Checkbox overlay component.
 * Injects a checkbox onto each video item in the playlist
 * for multi-select functionality.
 */

import {
  toggleSelection,
  isSelected,
  onSelectionChange,
} from "../services/selection-state";
import { createElement } from "../utils/dom-helpers";

/** CSS class prefix for all extension elements. */
const PREFIX = "rfpm";

/** Tracks injected checkboxes so we can clean up. */
const injectedCheckboxes = new Map<string, HTMLElement>();

/** Unsubscribe function for selection change listener. */
let unsubscribe: (() => void) | null = null;

/**
 * Injects a checkbox onto a single video renderer element.
 * No-ops if a checkbox is already present.
 */
export function injectCheckbox(
  renderer: HTMLElement,
  videoId: string,
): void {
  // Don't inject twice
  if (renderer.querySelector(`.${PREFIX}-checkbox`)) return;

  const wrapper = createElement("div", {
    class: `${PREFIX}-checkbox`,
    "data-video-id": videoId,
  });

  const input = createElement("input", {
    type: "checkbox",
    class: `${PREFIX}-checkbox-input`,
    "data-video-id": videoId,
  }) as HTMLInputElement;

  input.checked = isSelected(videoId);

  input.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  input.addEventListener("change", () => {
    toggleSelection(videoId);
  });

  wrapper.appendChild(input);

  // Insert the checkbox at the start of the renderer
  // (before the index number / drag handle area)
  renderer.style.position = "relative";
  renderer.insertBefore(wrapper, renderer.firstChild);

  injectedCheckboxes.set(videoId, wrapper);

  // Update the visual highlight on the renderer
  updateRendererHighlight(renderer, videoId);
}

/**
 * Injects checkboxes onto all video renderers in the container.
 */
export function injectAllCheckboxes(container: HTMLElement): void {
  const renderers = Array.from(
    container.querySelectorAll("ytd-playlist-video-renderer"),
  ) as HTMLElement[];

  for (const renderer of renderers) {
    const videoId = extractVideoIdFromRenderer(renderer);
    if (videoId) {
      injectCheckbox(renderer, videoId);
    }
  }
}

/**
 * Sets up a listener to keep checkboxes in sync with
 * the selection state.
 */
export function startCheckboxSync(): void {
  // Clean up any previous listener
  stopCheckboxSync();

  unsubscribe = onSelectionChange(() => {
    // Update all checkbox inputs and highlights
    for (const [videoId, wrapper] of injectedCheckboxes) {
      const input = wrapper.querySelector("input") as HTMLInputElement | null;
      if (input) {
        input.checked = isSelected(videoId);
      }

      // Update renderer highlight
      const renderer = wrapper.closest(
        "ytd-playlist-video-renderer",
      ) as HTMLElement | null;
      if (renderer) {
        updateRendererHighlight(renderer, videoId);
      }
    }
  });
}

/**
 * Stops the checkbox sync listener.
 */
export function stopCheckboxSync(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Removes all injected checkboxes and cleans up.
 */
export function removeAllCheckboxes(): void {
  stopCheckboxSync();

  for (const [, wrapper] of injectedCheckboxes) {
    // Remove highlight from renderer
    const renderer = wrapper.closest(
      "ytd-playlist-video-renderer",
    ) as HTMLElement | null;
    if (renderer) {
      renderer.classList.remove(`${PREFIX}-selected`);
    }

    wrapper.remove();
  }

  injectedCheckboxes.clear();
}

// ─── Internal Helpers ─────────────────────────────────────────────

/**
 * Adds or removes a highlight class on the renderer based on selection.
 */
function updateRendererHighlight(
  renderer: HTMLElement,
  videoId: string,
): void {
  if (isSelected(videoId)) {
    renderer.classList.add(`${PREFIX}-selected`);
  } else {
    renderer.classList.remove(`${PREFIX}-selected`);
  }
}

/**
 * Extracts the video ID from a playlist video renderer element.
 */
function extractVideoIdFromRenderer(renderer: HTMLElement): string | null {
  const link = renderer.querySelector(
    "a#video-title",
  ) as HTMLAnchorElement | null;
  if (!link) return null;

  try {
    const url = new URL(link.href, window.location.origin);
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}
