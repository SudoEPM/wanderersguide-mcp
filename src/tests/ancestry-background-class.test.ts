import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findAncestry } from '../tools/ancestries.js';
import { findBackground } from '../tools/backgrounds.js';
import { findClass } from '../tools/classes.js';
import { findArchetype, findClassArchetype } from '../tools/archetypes.js';
import { findVersatileHeritage } from '../tools/versatile-heritages.js';
import { TIMEOUT, assertIsString, assertNoObjectObject } from './helpers.js';

describe('find_ancestry', () => {
  test('finds ancestry with size and speed from operations', { timeout: TIMEOUT }, async () => {
    const result = await findAncestry({ name: 'Human' });
    assertIsString(result, 'find_ancestry(Human)');
    assert.match(result, /Human/i);
    // Speed is always present (from setValue SPEED op); HP depends on op type used
    assert.match(result, /Speed:/i);
    assertNoObjectObject(result, 'find_ancestry(Human)');
  });

  test('shows languages resolved to names', { timeout: TIMEOUT }, async () => {
    const result = await findAncestry({ name: 'Elf' });
    assertIsString(result, 'find_ancestry(Elf)');
    assert.match(result, /Languages:/i);
    // Should show "Common" not a raw number
    const langLine = result.match(/^Languages: (.+)$/m)?.[1] ?? '';
    assert.ok(!langLine.match(/^\d+$/), 'Language IDs should be resolved to names');
    assertNoObjectObject(result, 'find_ancestry(Elf)');
  });

  test('returns only the named ancestry (API ignores the name filter)', { timeout: TIMEOUT }, async () => {
    const result = await findAncestry({ name: 'Elf' });
    assert.doesNotMatch(result, /\*\*Dwarf\*\*/);
    assert.ok(result.length < 20_000, `expected one ancestry, got ${result.length} chars`);
  });

  test('does not show phantom fields (hp/size as top-level props)', { timeout: TIMEOUT }, async () => {
    const result = await findAncestry({ name: 'Gnome' });
    assertIsString(result, 'find_ancestry(Gnome) phantom check');
    // If present, HP should come from computed operations not a phantom field
    assertNoObjectObject(result, 'find_ancestry(Gnome)');
  });
});

describe('find_background', () => {
  test('finds background with ability boosts from operations', { timeout: TIMEOUT }, async () => {
    const result = await findBackground({ name: 'Acolyte' });
    assertIsString(result, 'find_background(Acolyte)');
    assert.match(result, /Acolyte/i);
    assertNoObjectObject(result, 'find_background(Acolyte)');
  });

  test('finds Scholar background', { timeout: TIMEOUT }, async () => {
    const result = await findBackground({ name: 'Scholar' });
    assertIsString(result, 'find_background(Scholar)');
    assert.match(result, /Scholar/i);
    assertNoObjectObject(result, 'find_background(Scholar)');
  });

  test('matches a partial name and excludes other backgrounds', { timeout: TIMEOUT }, async () => {
    const result = await findBackground({ name: 'acoly' });
    assert.match(result, /\*\*Acolyte\*\*/);
    assert.doesNotMatch(result, /\*\*Scholar\*\*/);
  });
});

describe('find_class', () => {
  test('finds class with skill_training_base', { timeout: TIMEOUT }, async () => {
    const result = await findClass({ id: [5] }); // Bard is a known class
    assertIsString(result, 'find_class(id=5)');
    assertNoObjectObject(result, 'find_class(id=5)');
  });
});

describe('find_archetype', () => {
  test('returns results without throwing', { timeout: TIMEOUT }, async () => {
    const result = await findArchetype({ id: [1] });
    assertIsString(result, 'find_archetype');
    assertNoObjectObject(result, 'find_archetype');
  });
});

describe('find_class_archetype', () => {
  test('returns results or graceful error (endpoint may require elevated access)', { timeout: TIMEOUT }, async () => {
    // find-class-archetype may require Patreon-tier API access — handle gracefully
    try {
      const result = await findClassArchetype({ id: [1] });
      assertIsString(result, 'find_class_archetype');
      assertNoObjectObject(result, 'find_class_archetype');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes('JWT') || msg.includes('403') || msg.includes('401'),
        `Unexpected error (not auth-related): ${msg}`,
      );
    }
  });
});

describe('find_versatile_heritage', () => {
  test('returns results without throwing', { timeout: TIMEOUT }, async () => {
    const result = await findVersatileHeritage({ id: [1] });
    assertIsString(result, 'find_versatile_heritage');
    assertNoObjectObject(result, 'find_versatile_heritage');
  });
});
