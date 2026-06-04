import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { findTrait } from '../tools/traits.js';
import { findLanguage } from '../tools/languages.js';
import { findContentSource } from '../tools/content-sources.js';
import { TIMEOUT, assertIsString, assertNoObjectObject } from './helpers.js';

describe('find_trait', () => {
  // find-trait requires an array of IDs — single ID or name search returns nothing (API quirk)
  test('resolves trait IDs to names with categories', { timeout: TIMEOUT }, async () => {
    const result = await findTrait({ id: [1476, 1569] }); // Poison, Agile
    assertIsString(result, 'find_trait(array)');
    assert.match(result, /Poison/i);
    assertNoObjectObject(result, 'find_trait(array)');
  });

  test('single ID is auto-wrapped to array', { timeout: TIMEOUT }, async () => {
    // Previously broken: single integer returned nothing; now normalized to array
    const result = await findTrait({ id: 1476 }); // Poison
    assertIsString(result, 'find_trait(single id)');
    assert.match(result, /Poison/i);
    assertNoObjectObject(result, 'find_trait(single id)');
  });

  test('shows meta_data categories when present', { timeout: TIMEOUT }, async () => {
    const result = await findTrait({ id: [1476] });
    assertIsString(result, 'find_trait(meta_data)');
    assertNoObjectObject(result, 'find_trait(meta_data)');
  });
});

describe('find_language', () => {
  test('finds language by name with speakers and script', { timeout: TIMEOUT }, async () => {
    const result = await findLanguage({ name: 'Common' });
    assertIsString(result, 'find_language(Common)');
    assert.match(result, /Common/i);
    assertNoObjectObject(result, 'find_language(Common)');
  });

  test('finds language by ID', { timeout: TIMEOUT }, async () => {
    const result = await findLanguage({ id: [81] }); // Common
    assertIsString(result, 'find_language(id=81)');
    assert.match(result, /Common/i);
    assertNoObjectObject(result, 'find_language(id=81)');
  });

  test('returns not-found for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findLanguage({ name: 'zzznomatchzzz' });
    assertIsString(result, 'find_language(nomatch)');
    assert.match(result, /No languages found/i);
  });
});

describe('find_content_source', () => {
  test('finds published content sources with correct field names', { timeout: TIMEOUT }, async () => {
    const result = await findContentSource({ published: true });
    assertIsString(result, 'find_content_source(published)');
    assertNoObjectObject(result, 'find_content_source(published)');
    // Should NOT show "homebrew: true" or "published: true" as phantom fields
    assert.ok(!result.includes('homebrew: true'), '"homebrew: true" is a phantom field');
  });
});
