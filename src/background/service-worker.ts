/**
 * Background service worker for RF YouTube Playlist Manager.
 * Handles OAuth token management via chrome.identity and proxies
 * YouTube Data API calls from the content script.
 *
 * Content scripts cannot use chrome.identity directly, so all auth
 * and API requests are routed through this service worker via
 * chrome.runtime.sendMessage.
 */

import type {
  ExtensionMessage,
  ExtensionResponse,
  ApiRequestPayload,
} from "../types/youtube";

// ─── Auth Token Management ────────────────────────────────────────

/**
 * Retrieves an OAuth token using chrome.identity.
 * If the user hasn't granted access yet, this will trigger
 * the OAuth consent flow.
 */
async function getAuthToken(interactive: boolean = true): Promise<string> {
  const result = await chrome.identity.getAuthToken({ interactive });

  if (!result.token) {
    throw new Error("No auth token returned");
  }

  return result.token;
}

/**
 * Removes the cached auth token. Useful when a token is expired
 * or revoked and we need to force a fresh one.
 */
async function removeAuthToken(token: string): Promise<void> {
  await chrome.identity.removeCachedAuthToken({ token });
}

// ─── API Request Proxy ────────────────────────────────────────────

/**
 * Executes an authenticated YouTube API request.
 * Automatically attaches the OAuth Bearer token.
 * If the token is expired (401), it removes the cached token
 * and retries once with a fresh token.
 */
async function executeApiRequest(
  payload: ApiRequestPayload,
): Promise<unknown> {
  const token = await getAuthToken();

  const response = await fetchWithToken(payload, token);

  // If unauthorized, token may be stale — refresh and retry once
  if (response.status === 401) {
    await removeAuthToken(token);
    const freshToken = await getAuthToken();
    const retryResponse = await fetchWithToken(payload, freshToken);

    if (!retryResponse.ok) {
      const errorBody = await retryResponse.text();
      throw new Error(
        `YouTube API error ${retryResponse.status}: ${errorBody}`,
      );
    }

    // 204 No Content (e.g. successful delete)
    if (retryResponse.status === 204) return null;
    return retryResponse.json();
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `YouTube API error ${response.status}: ${errorBody}`,
    );
  }

  // 204 No Content (e.g. successful delete)
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Performs a fetch with the given Bearer token.
 */
function fetchWithToken(
  payload: ApiRequestPayload,
  token: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  const init: RequestInit = {
    method: payload.method,
    headers,
  };

  if (payload.body && (payload.method === "POST" || payload.method === "PUT")) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(payload.body);
  }

  return fetch(payload.url, init);
}

// ─── Message Listener ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionResponse) => void,
  ) => {
    handleMessage(message)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err: Error) =>
        sendResponse({ success: false, error: err.message }),
      );

    // Return true to indicate we will respond asynchronously
    return true;
  },
);

async function handleMessage(
  message: ExtensionMessage,
): Promise<unknown> {
  switch (message.type) {
    case "GET_AUTH_TOKEN":
      return getAuthToken();

    case "REMOVE_AUTH_TOKEN": {
      const token = await getAuthToken(false);
      await removeAuthToken(token);
      return null;
    }

    case "API_REQUEST": {
      if (!message.payload) {
        throw new Error("API_REQUEST requires a payload");
      }
      return executeApiRequest(message.payload);
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}
