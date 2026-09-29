import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchContent, advancedSearch } from '../tools/search.js';
import { TIMEOUT, NO_MATCH, assertIsString, assertNoObjectObject } from './helpers.js';

describe('search_content', () => {
  test('returns results for a known term', { timeout: TIMEOUT }, async () => {
    const result = await searchContent({ query: 'fireball' });
    assertIsString(result, 'search_content(fireball)');
    assert.match(result, /fireball/i);
    assertNoObjectObject(result, 'search_content(fireball)');
  });

  test('filters by content type', { timeout: TIMEOUT }, async () => {
    const result = await searchContent({ query: 'fireball', type: 'spell' });
    assertIsString(result, 'search_content(fireball, spell)');
    assert.match(result, /\[spell\]/i);
  });

  test('returns not-found for unknown term', { timeout: TIMEOUT }, async () => {
    const result = await searchContent({ query: NO_MATCH });
    assertIsString(result, `search_content(${NO_MATCH})`);
    assert.match(result, /No results found/i);
  });
});

describe('advanced_search', () => {
  test('filters spells by rank, tradition, and trait name', { timeout: TIMEOUT }, async () => {
    const result = await advancedSearch({ type: 'spell', rank_min: 3, rank_max: 3, traditions: ['ARCANE'], traits: ['Fire'] });
    assert.match(result, /Fireball · Rank 3/);
    assert.doesNotMatch(result, /Rank [0-24-9]/);
  });

  test('filters creatures by trait client-side', { timeout: TIMEOUT }, async () => {
    const result = await advancedSearch({ type: 'creature', level_min: 4, level_max: 4, traits: ['Undead'], limit: 50 });
    assert.match(result, /Shadow · Level 4/);
    assert.doesNotMatch(result, /Army Ant Swarm/);
  });

  test('pages results with limit and offset', { timeout: TIMEOUT }, async () => {
    const result = await advancedSearch({ type: 'feat', level_max: 1, actions: 'REACTION', limit: 3, offset: 3 });
    assert.match(result, /showing 4–6 \(use offset 6 for more\)/);
    assert.equal(result.split('\n').length, 4);
  });

  test('rejects unknown trait names', { timeout: TIMEOUT }, async () => {
    await assert.rejects(advancedSearch({ type: 'spell', traits: [NO_MATCH] }), /Unknown trait/);
  });
});
