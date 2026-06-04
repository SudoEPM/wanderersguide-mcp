import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findCreature } from '../tools/creatures.js';
import { TIMEOUT, NO_MATCH, assertIsString, assertNoObjectObject } from './helpers.js';

describe('find_creature', () => {
  // find-creature requires exact name — partial search returns nothing
  test('finds creature by ID with computed HP, AC, saves', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ id: 10123 }); // Harpy L5
    assertIsString(result, 'find_creature(id=10123)');
    assert.match(result, /Harpy/i);
    assert.match(result, /HP \d+/i);
    assert.match(result, /AC \d+/i);
    assert.match(result, /Fort/i);
    assert.match(result, /Ref/i);
    assert.match(result, /Will/i);
    assertNoObjectObject(result, 'find_creature(id=10123)');
  });

  test('shows traits resolved to names', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ id: 10123 });
    assertIsString(result, 'find_creature traits');
    assert.match(result, /Traits:/i);
    // Traits should be names like "Air, Beast, Humanoid" not IDs
    const traitsLine = result.match(/^Traits: (.+)$/m)?.[1] ?? '';
    assert.ok(!traitsLine.match(/^\d+$/), 'Traits should be resolved names, not IDs');
  });

  test('shows fly speed for flying creatures', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ id: 10123 }); // Harpy has fly speed
    assertIsString(result, 'find_creature(fly speed)');
    assert.match(result, /fly/i);
  });

  test('shows abilities with action symbols', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ id: 10123 });
    assertIsString(result, 'find_creature(abilities)');
    assert.match(result, /Abilities:/i);
    assert.match(result, /◆/); // Harpy has TWO-ACTIONS: Hungry Winds
  });

  test('finds creature by exact name', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ name: 'Goblin Warrior' });
    assertIsString(result, 'find_creature(Goblin Warrior)');
    assertNoObjectObject(result, 'find_creature(Goblin Warrior)');
  });

  test('returns not-found for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ name: NO_MATCH });
    assertIsString(result, `find_creature(${NO_MATCH})`);
    assert.match(result, /No creatures found/i);
  });
});
