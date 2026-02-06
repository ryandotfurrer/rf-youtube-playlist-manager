/**
 * Duration parsing utilities.
 * Converts YouTube duration strings into total seconds for sorting.
 *
 * Handles two formats:
 *   - Display format from DOM: "12:34", "1:02:03"
 *   - ISO 8601 from API: "PT1H2M3S", "PT12M34S", "PT45S"
 */

/**
 * Parses a YouTube display duration string (e.g. "12:34" or "1:02:03")
 * into total seconds.
 *
 * Returns 0 if the string cannot be parsed.
 */
export function parseDurationText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const parts = trimmed.split(":").map(Number);

  if (parts.some(isNaN)) return 0;

  switch (parts.length) {
    case 1:
      // "45" -> 45 seconds
      return parts[0];
    case 2:
      // "12:34" -> 12 minutes, 34 seconds
      return parts[0] * 60 + parts[1];
    case 3:
      // "1:02:03" -> 1 hour, 2 minutes, 3 seconds
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    default:
      return 0;
  }
}

/**
 * Parses an ISO 8601 duration string from the YouTube API
 * (e.g. "PT1H2M3S", "PT12M34S", "PT45S") into total seconds.
 *
 * Returns 0 if the string cannot be parsed.
 */
export function parseISO8601Duration(iso: string): number {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Formats a duration in seconds to a display string.
 * e.g. 754 -> "12:34", 3723 -> "1:02:03"
 */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}
