// Countdown state. Every method takes `now` so it can be tested without real time passing.

export class Countdown {
  /**
   * @param {object} state
   * @param {string} [state.title]
   * @param {number} state.totalMs        Length of the full run (grows when buffer is added).
   * @param {number} state.thresholdMs    Seconds become visible below this.
   * @param {number} state.endAt          Epoch ms when the timer reaches zero (while running).
   * @param {boolean} [state.paused]
   * @param {number} [state.pausedRemainingMs] Remaining time frozen at the moment of pausing.
   * @param {boolean} [state.overtime] Keep counting up past zero instead of stopping at 0:00.
   */
  constructor({ title = '', totalMs, thresholdMs, endAt, paused = false, pausedRemainingMs = 0, overtime = false }) {
    this.title = String(title);
    this.totalMs = totalMs;
    this.thresholdMs = thresholdMs;
    this.endAt = endAt;
    this.paused = Boolean(paused);
    this.pausedRemainingMs = pausedRemainingMs;
    this.overtime = Boolean(overtime);
  }

  static start({ title, durationMs, thresholdMs, overtime }, now = Date.now()) {
    return new Countdown({ title, totalMs: durationMs, thresholdMs, endAt: now + durationMs, overtime });
  }

  /** Restores a countdown saved with JSON.stringify, or returns null if the data is unusable. */
  static fromJSON(data) {
    if (!data || typeof data !== 'object') return null;
    const numbers = [data.totalMs, data.thresholdMs, data.endAt, data.pausedRemainingMs ?? 0];
    return numbers.every(Number.isFinite) ? new Countdown(data) : null;
  }

  remainingMs(now = Date.now()) {
    return this.paused ? this.pausedRemainingMs : Math.max(0, this.endAt - now);
  }

  isDone(now = Date.now()) {
    return this.remainingMs(now) <= 0;
  }

  /** Time elapsed since the countdown reached zero (0 while time is left). */
  overtimeMs(now = Date.now()) {
    return this.paused ? 0 : Math.max(0, now - this.endAt);
  }

  /** Fraction of the run still left, from 1 down to 0. */
  progress(now = Date.now()) {
    return this.totalMs > 0 ? this.remainingMs(now) / this.totalMs : 0;
  }

  /** A running countdown that ended more than `maxAgeMs` ago is not worth resuming. */
  isStale(maxAgeMs, now = Date.now()) {
    return !this.paused && this.endAt < now - maxAgeMs;
  }

  togglePause(now = Date.now()) {
    if (this.isDone(now)) return;
    if (this.paused) this.endAt = now + this.pausedRemainingMs;
    else this.pausedRemainingMs = this.remainingMs(now);
    this.paused = !this.paused;
  }

  /** Adds (or with a negative value removes) time without stopping the countdown. */
  addTime(ms, now = Date.now()) {
    const next = Math.max(0, this.remainingMs(now) + ms);
    if (this.paused) this.pausedRemainingMs = next;
    else this.endAt = now + next;
    this.totalMs = Math.max(this.totalMs, next);
  }
}
