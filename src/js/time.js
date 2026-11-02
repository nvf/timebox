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
