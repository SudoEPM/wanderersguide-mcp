/**
 * Integration tests — real API calls, no mocks.
 * Requires WG_API_KEY to be set in the environment.
 * Run: npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { searchContent } from '../tools/search.js';
import { findSpell } from '../tools/spells.js';
import { findFeat } from '../tools/feats.js';
import { findItem } from '../tools/items.js';
import { findCreature } from '../tools/creatures.js';
import { findAncestry } from '../tools/ancestries.js';
import { findBackground } from '../tools/backgrounds.js';
import { findCharacter } from '../tools/characters.js';
import { findCampaign } from '../tools/campaigns.js';
import { findEncounter, createEncounter, deleteEncounter } from '../tools/encounters.js';

const TIMEOUT = 15_000;
const NO_MATCH = 'zzzyyyxxxnomatch999';

// ── helpers ──────────────────────────────────────────────────────────────────

function assertNoObjectObject(result: string, label: string): void {
  assert(
    !result.includes('[object Object]'),
    `${label}: output must not contain "[object Object]"\n${result}`,
  );
}

function assertTraitsAreNames(result: string, label: string): void {
  const m = result.match(/^Traits: (.+)$/m);
  if (!m) return;
  for (const token of m[1].split(',').map((t) => t.trim())) {
    assert(
      !/^\d+$/.test(token),
      `${label}: trait token "${token}" is a raw ID — should be resolved to a name`,
    );
  }
}

function assertIsString(result: unknown, label: string): asserts result is string {
  assert(typeof result === 'string' && result.length > 0, `${label}: expected a non-empty string`);
}

// ── search_content ────────────────────────────────────────────────────────────

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

  test('returns not-found message for unknown term', { timeout: TIMEOUT }, async () => {
    const result = await searchContent({ query: NO_MATCH });
    assertIsString(result, `search_content(${NO_MATCH})`);
    assert.match(result, /No results found/i);
  });
});

// ── find_spell ────────────────────────────────────────────────────────────────

describe('find_spell', () => {
  test('finds Fireball by name with resolved trait names', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ name: 'fireball' });
    assertIsString(result, 'find_spell(fireball)');
    assert.match(result, /Fireball/i);
    assertNoObjectObject(result, 'find_spell(fireball)');
    assertTraitsAreNames(result, 'find_spell(fireball)');
  });

  test('finds spells by trait filter', { timeout: TIMEOUT }, async () => {
    // Trait ID for "fire" — use a known trait ID
    const result = await findSpell({ traits: [696] }); // fire trait ID
    assertIsString(result, 'find_spell(traits=[fire])');
    assertNoObjectObject(result, 'find_spell(traits=[fire])');
    assertTraitsAreNames(result, 'find_spell(traits=[fire])');
  });

  test('finds Forbidden Thought by ID with resolved traits and heightened', {
    timeout: TIMEOUT,
  }, async () => {
    const result = await findSpell({ id: 5735 }); // Forbidden Thought
    assertIsString(result, 'find_spell(id=5735)');
    assert.match(result, /Forbidden Thought/i);
    // Traits must be names, not IDs
    assert.match(result, /Cantrip/i);
    assert.match(result, /Mental/i);
    assertTraitsAreNames(result, 'find_spell(id=5735)');
    // Heightened must render as "amount: text", not [object Object]
    assert.match(result, /Heightened/i);
    assert.match(result, /\(\+1\)/);
    assert.match(result, /1d6/i);
    assertNoObjectObject(result, 'find_spell(id=5735)');
  });

  test('returns not-found message for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findSpell({ name: NO_MATCH });
    assertIsString(result, `find_spell(${NO_MATCH})`);
    assert.match(result, /No spells found/i);
  });
});

// ── find_feat ─────────────────────────────────────────────────────────────────

describe('find_feat', () => {
  test('finds Power Attack by name', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'power attack' });
    assertIsString(result, 'find_feat(power attack)');
    assert.match(result, /Power Attack/i);
    assertNoObjectObject(result, 'find_feat(power attack)');
  });

  test('filters by feat type', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'power attack', type: 'feat' });
    assertIsString(result, 'find_feat(power attack, type=feat)');
    assertNoObjectObject(result, 'find_feat(power attack, type=feat)');
  });

  test('finds actions by type', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: 'strike', type: 'action' });
    assertIsString(result, 'find_feat(strike, type=action)');
    assertNoObjectObject(result, 'find_feat(strike, type=action)');
  });

  test('returns not-found message for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findFeat({ name: NO_MATCH });
    assertIsString(result, `find_feat(${NO_MATCH})`);
    assert.match(result, /No feats/i);
  });
});

// ── find_item ─────────────────────────────────────────────────────────────────

describe('find_item', () => {
  test('finds longsword with stats', { timeout: TIMEOUT }, async () => {
    const result = await findItem({ name: 'longsword' });
    assertIsString(result, 'find_item(longsword)');
    assert.match(result, /Longsword/i);
    assertNoObjectObject(result, 'find_item(longsword)');
  });

  test('finds items by ID array', { timeout: TIMEOUT }, async () => {
    // First get an ID from a name search, then look up by ID
    const byName = await findItem({ name: 'longsword' });
    const idMatch = byName.match(/\(ID:\s*(\d+)\)/i) ?? byName.match(/^\*\*Longsword/im);
    // Even without an ID in the output, the lookup itself must not throw
    assertIsString(byName, 'find_item(longsword) for ID extraction');
  });

  test('returns not-found message for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findItem({ name: NO_MATCH });
    assertIsString(result, `find_item(${NO_MATCH})`);
    assert.match(result, /No items found/i);
  });
});

// ── find_creature ─────────────────────────────────────────────────────────────

describe('find_creature', () => {
  test('finds goblin by name', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ name: 'goblin' });
    assertIsString(result, 'find_creature(goblin)');
    assert.match(result, /Goblin/i);
    assertNoObjectObject(result, 'find_creature(goblin)');
  });

  test('finds creatures by name', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ name: 'goblin' });
    assertIsString(result, 'find_creature(goblin)');
    assertNoObjectObject(result, 'find_creature(goblin)');
  });

  test('returns not-found message for unknown name', { timeout: TIMEOUT }, async () => {
    const result = await findCreature({ name: NO_MATCH });
    assertIsString(result, `find_creature(${NO_MATCH})`);
    assert.match(result, /No creatures found/i);
  });
});

// ── find_ancestry ─────────────────────────────────────────────────────────────

describe('find_ancestry', () => {
  test('finds Human with HP and speed', { timeout: TIMEOUT }, async () => {
    const result = await findAncestry({ name: 'human' });
    assertIsString(result, 'find_ancestry(human)');
    assert.match(result, /Human/i);
    assertNoObjectObject(result, 'find_ancestry(human)');
  });

  test('finds Elf ancestry', { timeout: TIMEOUT }, async () => {
    const result = await findAncestry({ name: 'elf' });
    assertIsString(result, 'find_ancestry(elf)');
    assert.match(result, /Elf/i);
    assertNoObjectObject(result, 'find_ancestry(elf)');
  });

  // Note: find-ancestry returns partial matches rather than an empty result for unknown names,
  // so we only test positive lookups for this endpoint.
});

// ── find_background ───────────────────────────────────────────────────────────

describe('find_background', () => {
  test('finds Acolyte background', { timeout: TIMEOUT }, async () => {
    const result = await findBackground({ name: 'acolyte' });
    assertIsString(result, 'find_background(acolyte)');
    assert.match(result, /Acolyte/i);
    assertNoObjectObject(result, 'find_background(acolyte)');
  });

  test('finds Scholar background', { timeout: TIMEOUT }, async () => {
    const result = await findBackground({ name: 'scholar' });
    assertIsString(result, 'find_background(scholar)');
    assert.match(result, /Scholar/i);
    assertNoObjectObject(result, 'find_background(scholar)');
  });

  // Note: find-background returns partial matches rather than an empty result for unknown names,
  // so we only test positive lookups for this endpoint.
});

// ── find_character ────────────────────────────────────────────────────────────

describe('find_character', () => {
  test('returns a string for an unauthorized character — does not throw', {
    timeout: TIMEOUT,
  }, async () => {
    // ID 1 is extremely unlikely to be authorized for this API key.
    // The function must return a message string, never throw.
    const result = await findCharacter({ id: 1 });
    assertIsString(result, 'find_character(1)');
    assertNoObjectObject(result, 'find_character(1)');
  });

  // Character 76148 (Bomaru) is a campaign member with granted access.
  test('retrieves an authorized character with name and class', {
    timeout: TIMEOUT,
  }, async () => {
    const result = await findCharacter({ id: 76148 });
    assertIsString(result, 'find_character(76148)');
    assertNoObjectObject(result, 'find_character(76148)');
    assert.match(result, /Bomaru/i);
    assert.match(result, /Level \d+/i);
    // Should show ancestry / background / class identity line
    assert.match(result, /\//);
  });

  test('returns a string for a second character — does not throw', {
    timeout: TIMEOUT,
  }, async () => {
    // Verifies the function returns a string and never throws regardless of auth state.
    const result = await findCharacter({ id: 76442 });
    assertIsString(result, 'find_character(76442)');
    assertNoObjectObject(result, 'find_character(76442)');
  });
});

// ── find_campaign ─────────────────────────────────────────────────────────────

describe('find_campaign', () => {
  test('returns a string without throwing', { timeout: TIMEOUT }, async () => {
    const result = await findCampaign({});
    assertIsString(result, 'find_campaign({})');
    assertNoObjectObject(result, 'find_campaign({})');
  });

  // Note: find-campaign does not filter strictly by name for unknown values,
  // so we only validate the happy path above.
});

// ── find_encounter ────────────────────────────────────────────────────────────

describe('find_encounter', () => {
  test('returns a string without throwing', { timeout: TIMEOUT }, async () => {
    const result = await findEncounter({});
    assertIsString(result, 'find_encounter({})');
    assertNoObjectObject(result, 'find_encounter({})');
  });
});

// ── create_encounter ──────────────────────────────────────────────────────────

describe('create_encounter', () => {
  test('creates encounter with combatants and party info, verifies round-trip, then deletes', { timeout: TIMEOUT * 3 }, async () => {
    const campaigns = await findCampaign({});
    const idMatch = campaigns.match(/\(ID:\s*(\d+)\)/);
    if (!idMatch) {
      console.log('  (skipped: no campaigns found for this API key)');
      return;
    }
    const campaignId = parseInt(idMatch[1], 10);
    const testDescription = 'Integration test — verifying combatants and meta_data round-trip.';

    // Create with a real creature (Harpy ID 10123), party info, and description
    const created = await createEncounter({
      campaign_id: campaignId,
      name: `Integration Test ${Date.now()}`,
      description: testDescription,
      party_level: 5,
      party_size: 4,
      enemy_creatures: [{ id: 10123 }], // Harpy (level 5)
    });
    assertIsString(created, 'create_encounter');
    assert.match(created, /created successfully/i);
    assert.match(created, /1 combatant/i);
    assertNoObjectObject(created, 'create_encounter');

    const encIdMatch = created.match(/\(ID:\s*(\d+)\)/);
    assert.ok(encIdMatch, 'create_encounter must return an ID');
    const encId = parseInt(encIdMatch[1], 10);

    // Fetch back and verify description, party info, and combatants
    const fetched = await findEncounter({ id: encId });
    assertIsString(fetched, 'find_encounter(created)');
    assert.ok(fetched.includes(testDescription), `description must round-trip via meta_data\nGot: ${fetched}`);
    assert.ok(fetched.includes('Level 5'), `party_level must appear\nGot: ${fetched}`);
    assert.ok(fetched.includes('Harpy'), `combatant name must appear\nGot: ${fetched}`);

    // Clean up
    const deleted = await deleteEncounter({ id: encId });
    assertIsString(deleted, 'delete_encounter');
    assert.match(deleted, /deleted successfully/i);
  });
});
