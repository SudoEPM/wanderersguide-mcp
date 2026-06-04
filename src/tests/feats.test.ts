import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findFeat } from '../tools/feats.js';
import { TIMEOUT, NO_MATCH, assertIsString, assertNoObjectObject, assertTraitsAreNames } from './helpers.js';

describe('find_feat', () => {
  test('finds feat by name and shows action symbol', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'Sudden Charge' });
    assertIsString(result, 'find_feat(Sudden Charge)');
    assert.match(result, /Sudden Charge/i);
    assert.match(result, /◆/);
    assertNoObjectObject(result, 'find_feat(Sudden Charge)');
  });

  test('shows rarity for non-common feats', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'Intimidating Strike' });
    assertIsString(result, 'find_feat(Intimidating Strike)');
    assertNoObjectObject(result, 'find_feat(Intimidating Strike)');
  });

  test('traits are resolved to names (not raw IDs)', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'Sudden Charge' });
    assertIsString(result, 'find_feat(Sudden Charge) traits');
    assertTraitsAreNames(result, 'find_feat(Sudden Charge)');
  });

  test('filters by type=feat', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ type: 'feat', name: 'Sudden Charge' });
    assertIsString(result, 'find_feat(type=feat)');
    assert.match(result, /\[feat\]/i);
    assertNoObjectObject(result, 'find_feat(type=feat)');
  });

  test('filters by type=action', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'strike', type: 'action' });
    assertIsString(result, 'find_feat(type=action)');
    assertNoObjectObject(result, 'find_feat(type=action)');
  });

  test('returns not-found for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: NO_MATCH });
    assertIsString(result, `find_feat(${NO_MATCH})`);
    assert.match(result, /No feats/i);
  });
});
