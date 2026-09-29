/**
 * API contract tests — validates that our TypeScript interfaces match the actual
 * OpenAPI response shapes. Each test fetches a real object and asserts that:
 *   1. Required fields from the spec are present
 *   2. Field types match the spec
 *   3. Phantom fields (fields we invented that don't exist in the API) are absent
 *
 * Run: npm test
 * Requires: WG_API_KEY in environment
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { wgFetch } from '../client.js';
import { getCurrentUserId } from '../tools/campaigns.js';

const TIMEOUT = 15_000;

function assertField<T>(obj: Record<string, unknown>, field: string, type: string, label: string): T {
  assert.ok(field in obj, `${label}: missing field "${field}"`);
  assert.strictEqual(typeof obj[field], type, `${label}: "${field}" should be ${type}, got ${typeof obj[field]}`);
  return obj[field] as T;
}

function assertOptionalField(obj: Record<string, unknown>, field: string, type: string, label: string): void {
  if (field in obj && obj[field] !== null) {
    assert.strictEqual(typeof obj[field], type, `${label}: "${field}" should be ${type} or null, got ${typeof obj[field]}`);
  }
}

function assertAbsent(obj: Record<string, unknown>, field: string, label: string): void {
  assert.ok(!(field in obj) || obj[field] === undefined, `${label}: field "${field}" should NOT exist (phantom field)`);
}

// ── Spell ────────────────────────────────────────────────────────────────────

describe('contract: Spell', () => {
  test('find-spell response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const results = await wgFetch<Record<string, unknown>[]>('find-spell', { name: 'Fireball' });
    assert.ok(results?.length > 0, 'expected at least one Fireball result');
    const s = results[0];
    assertField(s, 'id', 'number', 'Spell');
    assertField(s, 'name', 'string', 'Spell');
    assertField(s, 'rank', 'number', 'Spell');
    assertField(s, 'rarity', 'string', 'Spell');
    assertField(s, 'description', 'string', 'Spell');
    assert.ok(Array.isArray(s.traditions), 'Spell: traditions should be array');
    assert.ok(Array.isArray(s.traits), 'Spell: traits should be array');
    // Optional fields — present in Fireball
    assertOptionalField(s, 'cast', 'string', 'Spell');
    assertOptionalField(s, 'range', 'string', 'Spell');
    assertOptionalField(s, 'area', 'string', 'Spell');
    assertOptionalField(s, 'defense', 'string', 'Spell');
  });
});

// ── Item ─────────────────────────────────────────────────────────────────────

describe('contract: Item', () => {
  test('find-item response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const results = await wgFetch<Record<string, unknown>[]>('find-item', { name: 'Longsword' });
    assert.ok(results?.length > 0, 'expected at least one Longsword result');
    const item = results[0];
    assertField(item, 'id', 'number', 'Item');
    assertField(item, 'name', 'string', 'Item');
    assertField(item, 'level', 'number', 'Item');
    assertField(item, 'rarity', 'string', 'Item');
    assertField(item, 'description', 'string', 'Item');
    assertField(item, 'group', 'string', 'Item');
    assert.ok(Array.isArray(item.traits), 'Item: traits should be array of integers');
    if (item.traits && (item.traits as unknown[]).length > 0) {
      assert.strictEqual(typeof (item.traits as unknown[])[0], 'number', 'Item: trait elements should be integers');
    }
    // Phantom field check
    assertAbsent(item, 'category', 'Item');
  });
});

// ── AbilityBlock (Feat) ───────────────────────────────────────────────────────

describe('contract: AbilityBlock', () => {
  test('find-ability-block response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const results = await wgFetch<Record<string, unknown>[]>('find-ability-block', { name: 'Sudden Charge' });
    assert.ok(results?.length > 0, 'expected Sudden Charge results');
    const ab = results[0];
    assertField(ab, 'id', 'number', 'AbilityBlock');
    assertField(ab, 'name', 'string', 'AbilityBlock');
    assertField(ab, 'rarity', 'string', 'AbilityBlock');
    assertField(ab, 'description', 'string', 'AbilityBlock');
    assertField(ab, 'type', 'string', 'AbilityBlock');
    // actions is a string enum or null
    assert.ok('actions' in ab, 'AbilityBlock: should have actions field');
    assert.ok(Array.isArray(ab.traits), 'AbilityBlock: traits should be integer array');
    if (ab.traits && (ab.traits as unknown[]).length > 0) {
      assert.strictEqual(typeof (ab.traits as unknown[])[0], 'number', 'AbilityBlock: trait elements should be integers');
    }
    // prerequisites is an array in the API
    if ('prerequisites' in ab && ab.prerequisites !== null) {
      assert.ok(Array.isArray(ab.prerequisites), 'AbilityBlock: prerequisites should be array');
    }
  });
});

// ── Ancestry ──────────────────────────────────────────────────────────────────

describe('contract: Ancestry', () => {
  test('find-ancestry response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const results = await wgFetch<Record<string, unknown>[]>('find-ancestry', { id: [1, 2, 3, 4, 5] });
    assert.ok(results?.length > 0, 'expected ancestry results');
    const a = results[0];
    assertField(a, 'id', 'number', 'Ancestry');
    assertField(a, 'name', 'string', 'Ancestry');
    assertField(a, 'rarity', 'string', 'Ancestry');
    assertField(a, 'description', 'string', 'Ancestry');
    assert.ok(Array.isArray(a.operations), 'Ancestry: operations should be array');
    // Phantom field checks
    assertAbsent(a, 'hp', 'Ancestry');
    assertAbsent(a, 'size', 'Ancestry');
    assertAbsent(a, 'speed', 'Ancestry');
    assertAbsent(a, 'boosts', 'Ancestry');
    assertAbsent(a, 'flaws', 'Ancestry');
    assertAbsent(a, 'languages', 'Ancestry');
  });
});

// ── Background ────────────────────────────────────────────────────────────────

describe('contract: Background', () => {
  test('find-background response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const results = await wgFetch<Record<string, unknown>[]>('find-background', { name: 'Acolyte' });
    assert.ok(results?.length > 0, 'expected Background results');
    const b = results[0];
    assertField(b, 'id', 'number', 'Background');
    assertField(b, 'name', 'string', 'Background');
    assertField(b, 'rarity', 'string', 'Background');
    assertField(b, 'description', 'string', 'Background');
    assert.ok(Array.isArray(b.operations), 'Background: operations should be array');
    // Phantom field checks
    assertAbsent(b, 'boosts', 'Background');
    assertAbsent(b, 'skills', 'Background');
    assertAbsent(b, 'feats', 'Background');
  });
});

// ── Creature ──────────────────────────────────────────────────────────────────

describe('contract: Creature', () => {
  test('find-creature response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const raw = await wgFetch<Record<string, unknown> | Record<string, unknown>[]>('find-creature', { id: 10123 });
    const c = Array.isArray(raw) ? raw[0] : raw;
    assert.ok(c && typeof c === 'object', 'expected Creature result');
    assertField(c as Record<string, unknown>, 'id', 'number', 'Creature');
    assertField(c as Record<string, unknown>, 'name', 'string', 'Creature');
    assertField(c as Record<string, unknown>, 'level', 'number', 'Creature');
    assertField(c as Record<string, unknown>, 'rarity', 'string', 'Creature');
    assert.ok(Array.isArray((c as Record<string, unknown>).operations), 'Creature: operations should be array');
    assert.ok(Array.isArray((c as Record<string, unknown>).abilities_base), 'Creature: abilities_base should be array');
    // details object
    const details = (c as Record<string, unknown>).details as Record<string, unknown>;
    assert.ok(details && typeof details === 'object', 'Creature: details should be object');
    assert.ok('description' in details, 'Creature.details: should have description');
    // Phantom field checks
    assertAbsent(c as Record<string, unknown>, 'hp', 'Creature');
    assertAbsent(c as Record<string, unknown>, 'ac', 'Creature');
    assertAbsent(c as Record<string, unknown>, 'alignment', 'Creature');
  });
});

// ── Trait ─────────────────────────────────────────────────────────────────────

describe('contract: Trait', () => {
  test('find-trait response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    // find-trait requires an array of IDs; name/single-ID search returns nothing
    const results = await wgFetch<Record<string, unknown>[]>('find-trait', { id: [1476, 1569, 1570] });
    assert.ok(results?.length > 0, 'expected Trait results');
    const t = results[0];
    assertField(t, 'id', 'number', 'Trait');
    assertField(t, 'name', 'string', 'Trait');
    assertField(t, 'content_source_id', 'number', 'Trait');
    // meta_data with boolean flags
    assert.ok(t.meta_data && typeof t.meta_data === 'object', 'Trait: meta_data should be object');
  });
});

// ── Campaign ──────────────────────────────────────────────────────────────────

describe('contract: Campaign', () => {
  test('find-campaign response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    // An unfiltered find-campaign returns [], so filter by the caller's user_id
    const results = await wgFetch<Record<string, unknown>[]>('find-campaign', { user_id: await getCurrentUserId() });
    assert.ok(results?.length > 0, 'expected Campaign results');
    const c = results[0];
    assertField(c, 'id', 'number', 'Campaign');
    assertField(c, 'name', 'string', 'Campaign');
    assertField(c, 'user_id', 'string', 'Campaign');
    assertOptionalField(c, 'join_key', 'string', 'Campaign');
    // description is a string in practice (despite spec saying object)
    assert.ok('description' in c, 'Campaign: should have description field');
    // Phantom field checks
    assertAbsent(c, 'members', 'Campaign');
  });
});

// ── ContentSource ─────────────────────────────────────────────────────────────

describe('contract: ContentSource', () => {
  test('find-content-source response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const results = await wgFetch<Record<string, unknown>[]>('find-content-source', { published: true });
    assert.ok(results?.length > 0, 'expected ContentSource results');
    const s = results[0];
    assertField(s, 'id', 'number', 'ContentSource');
    assertField(s, 'name', 'string', 'ContentSource');
    assertField(s, 'url', 'string', 'ContentSource');
    assertField(s, 'is_published', 'boolean', 'ContentSource');
    // Phantom field checks
    assertAbsent(s, 'published', 'ContentSource');
    assertAbsent(s, 'homebrew', 'ContentSource');
  });
});

// ── Character ─────────────────────────────────────────────────────────────────

describe('contract: Character', () => {
  test('find-character response matches OpenAPI schema', { timeout: TIMEOUT }, async () => {
    const raw = await wgFetch<Record<string, unknown> | Record<string, unknown>[]>('find-character', { id: 76148 });
    const c = Array.isArray(raw) ? raw[0] : raw;
    assert.ok(c && typeof c === 'object', 'expected Character result');
    const ch = c as Record<string, unknown>;
    assertField(ch, 'id', 'number', 'Character');
    assertField(ch, 'name', 'string', 'Character');
    assertField(ch, 'level', 'number', 'Character');
    assertField(ch, 'user_id', 'string', 'Character');
    assert.ok(ch.inventory && typeof ch.inventory === 'object', 'Character: inventory should be object');
    assert.ok(ch.details && typeof ch.details === 'object', 'Character: details should be object');
    assert.ok(ch.spells && typeof ch.spells === 'object', 'Character: spells should be object');
    assert.ok(ch.meta_data && typeof ch.meta_data === 'object', 'Character: meta_data should be object');
  });
});
