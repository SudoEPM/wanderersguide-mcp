import assert from 'node:assert/strict';

export const TIMEOUT = 15_000;
export const NO_MATCH = 'zzzyyyxxxnomatch999';

export function assertIsString(result: unknown, label: string): asserts result is string {
  assert(typeof result === 'string' && result.length > 0, `${label}: expected a non-empty string`);
}

export function assertNoObjectObject(result: string, label: string): void {
  assert(
    !result.includes('[object Object]'),
    `${label}: output must not contain "[object Object]"\n${result}`,
  );
}

export function assertTraitsAreNames(result: string, label: string): void {
  const m = result.match(/^Traits: (.+)$/m);
  if (!m) return;
  for (const token of m[1].split(',').map((t) => t.trim())) {
    assert(
      !/^\d+$/.test(token),
      `${label}: trait token "${token}" is a raw ID — should be resolved to a name`,
    );
  }
}
