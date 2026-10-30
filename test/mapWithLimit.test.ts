import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapWithLimit } from '../src/mapWithLimit';

test('keeps input order and never exceeds the limit', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithLimit([5, 1, 4, 2, 3, 0], 2, async (value) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, value));
    running--;
    return value * 10;
  });
  assert.deepEqual(results, [50, 10, 40, 20, 30, 0]);
  assert.equal(peak, 2);
});

test('handles an empty list', async () => {
  assert.deepEqual(await mapWithLimit([], 3, async (value) => value), []);
});
