import assert from 'node:assert/strict';
import test from 'node:test';

import { ExponentialBackoff } from '../../src/ingest/backoff.js';

test('backoff grows, caps, and resets with deterministic jitter', () => {
  const backoff = new ExponentialBackoff({ baseMs: 100, maxMs: 250, jitterRatio: 0, random: () => 0.5 });
  assert.deepEqual([backoff.nextDelay(), backoff.nextDelay(), backoff.nextDelay(), backoff.nextDelay()], [100, 200, 250, 250]);
  assert.equal(backoff.currentAttempt(), 4);
  backoff.reset();
  assert.equal(backoff.nextDelay(), 100);
});
