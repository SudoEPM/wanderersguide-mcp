import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findItem } from '../tools/items.js';
import { TIMEOUT, NO_MATCH, assertIsString, assertNoObjectObject, assertTraitsAreNames } from './helpers.js';

describe('find_item', () => {
  test('finds item by name with resolved traits', { timeout: TIMEOUT }, async () => {
    const result = await findItem({ name: 'Longsword' });
    assertIsString(result, 'find_item(Longsword)');
    assert.match(result, /Longsword/i);
    assertTraitsAreNames(result, 'find_item(Longsword)');
    assertNoObjectObject(result, 'find_item(Longsword)');
  });

  test('shows group and bulk', { timeout: TIMEOUT }, async () => {
    const result = await findItem({ name: 'Longsword' });
    assertIsString(result, 'find_item(Longsword)');
    assert.match(result, /Group:/i);
    assert.match(result, /Bulk:/i);
  });

  test('does not show "category" (phantom field)', { timeout: TIMEOUT }, async () => {
    const result = await findItem({ name: 'Longsword' });
    assertIsString(result, 'find_item(Longsword) phantom check');
    assert.ok(!result.includes('Category:'), 'Category is a phantom field and must not appear');
  });

  test('finds item by ID', { timeout: TIMEOUT }, async () => {
    // Longsword
    const result = await findItem({ id: [6831] });
    assertIsString(result, 'find_item(id=6831)');
    assertNoObjectObject(result, 'find_item(id=6831)');
  });

  test('returns not-found for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findItem({ name: NO_MATCH });
    assertIsString(result, `find_item(${NO_MATCH})`);
    assert.match(result, /No items found/i);
  });
});
