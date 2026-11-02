import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, SECOND, clamp, formatRemaining, msUntilClockTime } from '../src/js/time.js';

const run = { thresholdMs: 5 * MINUTE, totalMs: 90 * MINUTE };

test('shows whole minutes, rounded up, above the threshold', () => {
  assert.deepEqual(formatRemaining(47 * MINUTE + 1, run), { text: '48min', html: '48<small>min</small>', phase: 'normal' });
  assert.equal(formatRemaining(5 * MINUTE + SECOND, run).text, '6min');
});

test('shows hours and minutes for long runs', () => {
  assert.equal(formatRemaining(85 * MINUTE, run).text, '1h 25m');
  assert.equal(formatRemaining(60 * MINUTE, run).text, '1h 00m');
});

test('switches to m:ss at the threshold and highlights it', () => {
  assert.deepEqual(formatRemaining(5 * MINUTE, run), { text: '5:00', html: '5:00', phase: 'warn' });
  assert.equal(formatRemaining(4 * MINUTE + 32 * SECOND, run).text, '4:32');
});

test('marks the final minute and the end', () => {
  assert.equal(formatRemaining(60 * SECOND, run).phase, 'end');
  assert.equal(formatRemaining(61 * SECOND, run).phase, 'warn');
  assert.deepEqual(formatRemaining(0, run), { text: '0:00', html: '0:00', phase: 'done' });
});

test('does not highlight when seconds are shown for the whole run', () => {
  const alwaysSeconds = { thresholdMs: 10 * MINUTE, totalMs: 10 * MINUTE };
  assert.equal(formatRemaining(9 * MINUTE, alwaysSeconds).phase, 'normal');
});

test('shows h:mm:ss when the threshold is above an hour', () => {
  assert.equal(formatRemaining(61 * MINUTE + 5 * SECOND, { thresholdMs: 120 * MINUTE, totalMs: 180 * MINUTE }).text, '1:01:05');
});

test('msUntilClockTime targets today, or tomorrow if the time has passed', () => {
  const now = new Date(2026, 0, 1, 10, 0, 0);
  assert.equal(msUntilClockTime('11:30', now), 90 * MINUTE);
  assert.equal(msUntilClockTime('09:00', now), 23 * 60 * MINUTE);
  assert.equal(msUntilClockTime('10:00', now), 24 * 60 * MINUTE);
});

test('clamp keeps values in range', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});
