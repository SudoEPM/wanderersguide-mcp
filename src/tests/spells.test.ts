import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findSpell } from '../tools/spells.js';
import { TIMEOUT, NO_MATCH, assertIsString, assertNoObjectObject, assertTraitsAreNames } from './helpers.js';

describe('find_spell', () => {
  test('suggests similar names when an exact name misses', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ name: 'Fireb' });
    assert.match(result, /No spells found/);
    assert.match(result, /Did you mean: .*Fireball \(ID: \d+\)/);
  });

  test('finds Fireball by name with area and defense', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ name: 'Fireball' });
    assertIsString(result, 'find_spell(Fireball)');
    assert.match(result, /Fireball/i);
    assert.match(result, /Area:/i);
    assert.match(result, /Defense:/i);
    assertTraitsAreNames(result, 'find_spell(Fireball)');
    assertNoObjectObject(result, 'find_spell(Fireball)');
  });

  test('finds spells by trait filter (array of IDs)', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ traits: [696] });
    assertIsString(result, 'find_spell(traits=[fire])');
    assertTraitsAreNames(result, 'find_spell(traits=[fire])');
    assertNoObjectObject(result, 'find_spell(traits=[fire])');
  });

  test('finds spell by ID with resolved traits and heightened', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ id: 5735 }); // Forbidden Thought
    assertIsString(result, 'find_spell(id=5735)');
    assert.match(result, /Forbidden Thought/i);
    assert.match(result, /Cantrip/i);
    assert.match(result, /Heightened/i);
    assertTraitsAreNames(result, 'find_spell(id=5735)');
    assertNoObjectObject(result, 'find_spell(id=5735)');
  });

  test('returns not-found for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ name: NO_MATCH });
    assertIsString(result, `find_spell(${NO_MATCH})`);
    assert.match(result, /No spells found/i);
  });
});
