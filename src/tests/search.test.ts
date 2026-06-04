import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchContent } from '../tools/search.js';
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
