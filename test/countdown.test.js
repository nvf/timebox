import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Countdown } from '../src/js/countdown.js';
import { MINUTE } from '../src/js/time.js';

const T0 = 1_000_000;
const start = (minutes = 10) =>
  Countdown.start({ title: 'Quiz', durationMs: minutes * MINUTE, thresholdMs: 5 * MINUTE }, T0);

test('counts down from the start time', () => {
  const countdown = start();
  assert.equal(countdown.remainingMs(T0), 10 * MINUTE);
  assert.equal(countdown.remainingMs(T0 + 4 * MINUTE), 6 * MINUTE);
  assert.equal(countdown.progress(T0 + 5 * MINUTE), 0.5);
});

test('never goes below zero', () => {
  const countdown = start();
  assert.equal(countdown.remainingMs(T0 + 20 * MINUTE), 0);
  assert.ok(countdown.isDone(T0 + 10 * MINUTE));
});

test('pausing freezes the remaining time and resuming continues from it', () => {
  const countdown = start();
  countdown.togglePause(T0 + 2 * MINUTE);
  assert.equal(countdown.remainingMs(T0 + 7 * MINUTE), 8 * MINUTE);

  countdown.togglePause(T0 + 7 * MINUTE);
  assert.equal(countdown.remainingMs(T0 + 8 * MINUTE), 7 * MINUTE);
});

test('cannot pause once finished', () => {
  const countdown = start();
  countdown.togglePause(T0 + 11 * MINUTE);
  assert.equal(countdown.paused, false);
});

test('adding buffer extends a running countdown and grows the total', () => {
  const countdown = start();
  countdown.addTime(MINUTE, T0 + 9.5 * MINUTE);
  assert.equal(countdown.remainingMs(T0 + 9.5 * MINUTE), 1.5 * MINUTE);
  assert.equal(countdown.totalMs, 10 * MINUTE);

  countdown.addTime(10 * MINUTE, T0 + 9.5 * MINUTE);
  assert.equal(countdown.totalMs, 11.5 * MINUTE);
});

test('buffer can restart a finished countdown, and removing time stops at zero', () => {
  const countdown = start();
  countdown.addTime(MINUTE, T0 + 12 * MINUTE);
  assert.equal(countdown.remainingMs(T0 + 12 * MINUTE), MINUTE);

  countdown.addTime(-5 * MINUTE, T0 + 12 * MINUTE);
  assert.equal(countdown.remainingMs(T0 + 12 * MINUTE), 0);
});

test('adding buffer while paused keeps it paused', () => {
  const countdown = start();
  countdown.togglePause(T0);
  countdown.addTime(MINUTE, T0 + MINUTE);
  assert.equal(countdown.paused, true);
  assert.equal(countdown.remainingMs(T0 + 5 * MINUTE), 11 * MINUTE);
});

test('round-trips through JSON and rejects broken data', () => {
  const countdown = start();
  const restored = Countdown.fromJSON(JSON.parse(JSON.stringify(countdown)));
  assert.deepEqual(restored, countdown);

  assert.equal(Countdown.fromJSON(null), null);
  assert.equal(Countdown.fromJSON({ totalMs: 'x', thresholdMs: 0, endAt: 0 }), null);
});

test('a long-finished countdown is stale, a paused one never is', () => {
  const countdown = start();
  assert.equal(countdown.isStale(60 * MINUTE, T0 + 30 * MINUTE), false);
  assert.equal(countdown.isStale(60 * MINUTE, T0 + 80 * MINUTE), true);

  countdown.togglePause(T0);
  assert.equal(countdown.isStale(60 * MINUTE, T0 + 500 * MINUTE), false);
});
