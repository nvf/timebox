// Pure time helpers: no DOM access, so they can be unit-tested in Node.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const FINAL_PHASE_SECONDS = 60;

/** @typedef {'normal' | 'warn' | 'end' | 'done'} Phase */
/** @typedef {{ text: string, html: string, phase: Phase }} Display */

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const pad = (n) => String(n).padStart(2, '0');

/**
 * Formats the remaining time for the big clock.
 * Above the threshold only whole minutes are shown (rounded up), below it m:ss.
 *
 * @param {number} remainingMs
 * @param {{ thresholdMs: number, totalMs: number }} options
 * @returns {Display}
 */
export function formatRemaining(remainingMs, { thresholdMs, totalMs }) {
  const seconds = Math.ceil(remainingMs / SECOND);
  if (seconds <= 0) return { text: '0:00', html: '0:00', phase: 'done' };
  if (seconds * SECOND > thresholdMs) return formatMinutes(seconds);

  // Only highlight the seconds phase if it is not the whole run.
  return formatSeconds(seconds, thresholdMs < totalMs);
}

function formatMinutes(seconds) {
  const totalMinutes = Math.ceil(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return { text: `${minutes}min`, html: `${minutes}<small>min</small>`, phase: 'normal' };
  }
  return {
    text: `${hours}h ${pad(minutes)}m`,
    html: `${hours}<small>h</small> ${pad(minutes)}<small>m</small>`,
    phase: 'normal',
  };
}

function formatSeconds(seconds, highlight) {
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = seconds % SECONDS_PER_MINUTE;
  const text = hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;

  let phase = 'normal';
  if (seconds <= FINAL_PHASE_SECONDS) phase = 'end';
  else if (highlight) phase = 'warn';

  return { text, html: text, phase };
}

/**
 * Milliseconds from `now` until the next occurrence of a wall-clock time ("HH:MM").
 * A time that has already passed today means tomorrow.
 *
 * @param {string} hhmm
 * @param {Date} [now]
 */
export function msUntilClockTime(hhmm, now = new Date()) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const end = new Date(now);
  end.setHours(hours, minutes, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end - now;
}

/**
 * Formats time past zero for the big clock, e.g. "+2:13" or "+1:02:05".
 *
 * @param {number} overtimeMs
 */
export function formatOvertime(overtimeMs) {
  const seconds = Math.max(0, Math.floor(overtimeMs / SECOND));
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const secs = seconds % SECONDS_PER_MINUTE;
  return hours > 0 ? `+${hours}:${pad(minutes)}:${pad(secs)}` : `+${minutes}:${pad(secs)}`;
}

/**
 * Human-readable length for form hints, rounded up to whole minutes: "45 min", "1 h 25 min", "2 h".
 *
 * @param {number} ms
 */
export function formatDuration(ms) {
  const totalMinutes = Math.ceil(ms / MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

const UNIT_MS = { h: 60 * MINUTE, min: MINUTE, m: MINUTE, s: SECOND };

/**
 * Parses a typed duration. Accepts minutes ("90", "1.5", "1,5"), h:mm ("1:30"),
 * and units ("1h30", "1h 30m", "45m", "90s"). Returns milliseconds, or NaN if unreadable.
 *
 * @param {string} input
 */
export function parseDuration(input) {
  const text = String(input).trim().toLowerCase().replace(/,/g, '.');
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text) * MINUTE;

  const clock = text.match(/^(\d+):([0-5]\d)$/);
  if (clock) return Number(clock[1]) * UNIT_MS.h + Number(clock[2]) * MINUTE;

  const tokens = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(h|min|m|s)?\s*/g)];
  if (tokens.length === 0 || tokens.map((t) => t[0]).join('') !== text) return NaN;

  let total = 0;
  for (const [index, [, amount, unit]] of tokens.entries()) {
    // A bare number is only allowed last, right after hours: "1h30" = 1 h 30 min.
    const afterHours = index > 0 && tokens[index - 1][2] === 'h' && index === tokens.length - 1;
    if (!unit && !afterHours) return NaN;
    total += Number(amount) * UNIT_MS[unit ?? 'm'];
  }
  return total;
}
