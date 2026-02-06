/**
 * DOM helper utilities.
 * Query selector wrappers, MutationObserver helpers,
 * and element creation utilities for working with YouTube's DOM.
 */

/**
 * Typed querySelector wrapper. Returns null if not found.
 */
export function qs<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T | null {
  return parent.querySelector<T>(selector);
}

/**
 * Typed querySelectorAll wrapper. Returns a real array.
 */
export function qsa<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): T[] {
  return Array.from(parent.querySelectorAll<T>(selector));
}

/**
 * Waits for an element matching the selector to appear in the DOM.
 * Uses a MutationObserver under the hood. Times out after the
 * specified duration (default 10s).
 */
export function waitForElement<T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
  timeoutMs: number = 10000,
): Promise<T | null> {
  return new Promise((resolve) => {
    // Check if it already exists
    const existing = parent.querySelector<T>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = parent.querySelector<T>(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(parent instanceof Document ? parent.body : parent, {
      childList: true,
      subtree: true,
    });

    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Creates an HTML element with optional attributes and children.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === "string") {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }

  return el;
}

/**
 * Observes a target element for child list changes.
 * Returns a disconnect function.
 */
export function observeChildList(
  target: Node,
  callback: MutationCallback,
  subtree: boolean = true,
): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(target, { childList: true, subtree });
  return () => observer.disconnect();
}

/**
 * Debounces a function call.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}
