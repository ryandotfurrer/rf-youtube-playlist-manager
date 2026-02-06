/**
 * Authentication service for the content script.
 * Communicates with the background service worker to obtain
 * and refresh OAuth tokens via chrome.identity.
 *
 * Content scripts can't call chrome.identity directly, so
 * all token operations go through chrome.runtime.sendMessage.
 */

import type {
  ExtensionMessage,
  ExtensionResponse,
  ApiRequestPayload,
} from "../../types/youtube";

/**
 * Sends a message to the background service worker and returns
 * the response. Throws on failure.
 */
async function sendMessage<T = unknown>(
  message: ExtensionMessage,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: ExtensionResponse<T>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response.success) {
        reject(new Error(response.error ?? "Unknown error"));
        return;
      }
      resolve(response.data as T);
    });
  });
}

/**
 * Requests an OAuth token from the background service worker.
 * Will trigger the consent flow if needed.
 */
export async function getAuthToken(): Promise<string> {
  return sendMessage<string>({ type: "GET_AUTH_TOKEN" });
}

/**
 * Tells the background to clear the cached OAuth token.
 */
export async function removeAuthToken(): Promise<void> {
  await sendMessage({ type: "REMOVE_AUTH_TOKEN" });
}

/**
 * Sends an authenticated API request through the background
 * service worker. The background handles token attachment
 * and 401 retry logic.
 */
export async function apiRequest<T = unknown>(
  payload: ApiRequestPayload,
): Promise<T> {
  return sendMessage<T>({ type: "API_REQUEST", payload });
}
