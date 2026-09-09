// Scaffold smoke test. The geometry slice replaces this file with real tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../src/geometry.ts';

test('geometry: stubs are not yet implemented', async () => {
  const fns = Object.values(m).filter((v) => typeof v === 'function' && !/^[A-Z]|^(pt|mm)$/.test(v.name));
  assert.ok(fns.length > 0);
  for (const fn of fns) await assert.rejects(async () => (fn as (...a: unknown[]) => unknown)(), /not implemented/);
});
