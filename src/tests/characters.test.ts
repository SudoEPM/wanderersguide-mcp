import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findCharacter } from '../tools/characters.js';
import { TIMEOUT, assertIsString, assertNoObjectObject } from './helpers.js';

// Bomaru (ID 76148) is a Level 5 Tanuki Bard in campaign 2391 with granted access.

describe('find_character', () => {
  test('retrieves character with full computed stats', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(76148)');
    assert.match(result, /Bomaru/i);
    assert.match(result, /Level 5/i);
    // Should show computed HP/max, AC, perception, speed
    assert.match(result, /HP: \d+\/\d+/i);
    assert.match(result, /AC: \d+/i);
    assert.match(result, /Perc:/i);
    assert.match(result, /Speed:/i);
    assertNoObjectObject(result, 'find_character(76148)');
  });

  test('shows saving throws', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(saves)');
    assert.match(result, /Fort:/i);
    assert.match(result, /Ref:/i);
    assert.match(result, /Will:/i);
  });

  test('shows trained+ skills (not untrained)', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(skills)');
    assert.match(result, /Skills:/i);
    // Skill proficiency types should be T/E/M/L, not raw numbers
    assert.match(result, /\([TEML]\)/);
  });

  test('shows spells resolved to names grouped by rank', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(spells)');
    assert.match(result, /Cantrips/i);
    // Bomaru knows Fireball... actually he knows Telekinetic Projectile
    assert.match(result, /Telekinetic Projectile/i);
    assertNoObjectObject(result, 'find_character(spells)');
  });

  test('shows languages resolved to names', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(languages)');
    assert.match(result, /Languages:/i);
    assert.match(result, /Common/i);
  });

  test('shows inventory with container contents', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(inventory)');
    assert.match(result, /Inventory:/i);
    assert.match(result, /Backpack/i);
    // Container contents should be nested
    assert.match(result, /•/); // bullet for nested items
  });

  test('retrieves all characters in campaign by campaign_id', { timeout: TIMEOUT * 2 }, async () => {
    const result = await findCharacter({ campaign_id: 2391 });
    assertIsString(result, 'find_character(campaign_id=2391)');
    assert.match(result, /Bomaru/i);
    assertNoObjectObject(result, 'find_character(campaign_id=2391)');
  });

  test('returns graceful message for unauthorized character', { timeout: TIMEOUT }, async () => {
    const result = await findCharacter({ id: 1 });
    assertIsString(result, 'find_character(unauthorized)');
    assertNoObjectObject(result, 'find_character(unauthorized)');
  });
});
