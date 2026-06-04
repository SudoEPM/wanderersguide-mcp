import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { findCampaign } from '../tools/campaigns.js';
import { findEncounter, createEncounter, updateEncounter, deleteEncounter } from '../tools/encounters.js';
import type { Creature } from '../tools/creatures.js';
import { TIMEOUT, assertIsString, assertNoObjectObject } from './helpers.js';

describe('find_campaign', () => {
  test('returns campaigns with join_key', { timeout: TIMEOUT }, async () => {
    const result = await findCampaign({});
    assertIsString(result, 'find_campaign');
    assertNoObjectObject(result, 'find_campaign');
    // Should show join key now that members phantom field is removed
    assert.match(result, /Join Key:/i);
  });

  test('does not show phantom "Members" field', { timeout: TIMEOUT }, async () => {
    const result = await findCampaign({});
    assertIsString(result, 'find_campaign phantom check');
    assert.ok(!result.includes('Members:'), '"Members:" is a phantom field and must not appear');
  });
});

describe('find_encounter', () => {
  test('returns encounters without throwing', { timeout: TIMEOUT }, async () => {
    const result = await findEncounter({ campaign_id: 2391 });
    assertIsString(result, 'find_encounter(campaign_id=2391)');
    assertNoObjectObject(result, 'find_encounter(campaign_id=2391)');
  });

  test('shows party level and description from meta_data', { timeout: TIMEOUT }, async () => {
    const result = await findEncounter({ campaign_id: 2391 });
    assertIsString(result, 'find_encounter(meta_data)');
    // The Harpy's Lure has party_level: 5
    assert.match(result, /Party:/i);
  });
});

describe('create_encounter with custom creature', () => {
  test('custom creature: stats, immunities, weaknesses, senses all split correctly', { timeout: TIMEOUT * 3 }, async () => {
    const campaigns = await findCampaign({});
    const idMatch = campaigns.match(/\(ID:\s*(\d+)\)/);
    if (!idMatch) { console.log('  (skipped: no campaigns found)'); return; }
    const campaignId = parseInt(idMatch[1], 10);

    const v = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const ghost: Creature = {
      name: 'Test Ghost',
      level: 4,
      rarity: 'UNCOMMON',
      details: { description: 'A test custom creature.' },
      operations: [
        { id: randomUUID(), type: 'adjValue',        data: { variable: 'MAX_HEALTH_BONUS', value: 50 } },
        { id: randomUUID(), type: 'adjValue',        data: { variable: 'AC_BONUS', value: 8 } },
        { id: randomUUID(), type: 'addBonusToValue', data: { variable: 'SAVE_FORT',   text: '', value: v(7) } },
        { id: randomUUID(), type: 'addBonusToValue', data: { variable: 'SAVE_REFLEX', text: '', value: v(10) } },
        { id: randomUUID(), type: 'addBonusToValue', data: { variable: 'SAVE_WILL',   text: '', value: v(12) } },
        { id: randomUUID(), type: 'addBonusToValue', data: { variable: 'PERCEPTION',  text: '', value: v(10) } },
        { id: randomUUID(), type: 'setValue',        data: { variable: 'SPEED_FLY', value: 25 } },
        // Multi-value in one string — should be split into separate operations
        { id: randomUUID(), type: 'adjValue', data: { variable: 'IMMUNITIES', value: 'death effects, disease, poison' } },
        // Amount format — "silver, 5" must NOT be split
        { id: randomUUID(), type: 'adjValue', data: { variable: 'WEAKNESSES', value: 'silver, 5, cold iron, 3' } },
        // Single sense with amount — must NOT be split
        { id: randomUUID(), type: 'adjValue', data: { variable: 'SENSES_IMPRECISE', value: 'lifesense, 60' } },
      ],
      abilities_base: [
        { name: 'Haunting Touch', actions: 'ONE-ACTION', description: 'Melee spell attack. 2d6 negative damage.', traits: [] },
      ],
      spells: { slots: [], list: [], focus_point_current: 0, innate_casts: [] },
      inventory: { coins: { cp: 0, sp: 0, gp: 0, pp: 0 }, items: [] },
    };

    const created = await createEncounter({
      campaign_id: campaignId,
      name: `Custom Creature Test ${Date.now()}`,
      custom_enemies: [ghost],
    });
    assertIsString(created, 'create_encounter(custom)');
    assert.match(created, /created successfully/i);
    assert.match(created, /1 combatant/i);
    const encId = parseInt(created.match(/\(ID:\s*(\d+)\)/)![1], 10);

    // Fetch back and verify the creature round-trips
    const fetched = await findEncounter({ id: encId });
    assertIsString(fetched, 'find_encounter(custom)');
    assert.ok(fetched.includes('Test Ghost'), `creature name must appear\nGot: ${fetched}`);
    assertNoObjectObject(fetched, 'find_encounter(custom)');

    // Verify the normalization via raw API — each immunity must be a separate operation
    const { wgFetch } = await import('../client.js');
    const raw = await wgFetch<{ combatants?: { list?: { creature?: { operations?: { type: string; data?: { variable?: string; value?: unknown } }[] } }[] } }[]>('find-encounter', { id: encId });
    const ops = raw?.[0]?.combatants?.list?.[0]?.creature?.operations ?? [];

    const immunityOps = ops.filter((o) => o.type === 'adjValue' && o.data?.variable === 'IMMUNITIES');
    assert.strictEqual(immunityOps.length, 3, `"death effects, disease, poison" must produce 3 separate IMMUNITIES ops (got ${immunityOps.length})`);

    const weaknessOps = ops.filter((o) => o.type === 'adjValue' && o.data?.variable === 'WEAKNESSES');
    assert.strictEqual(weaknessOps.length, 2, `"silver, 5, cold iron, 3" must produce 2 separate WEAKNESSES ops (got ${weaknessOps.length})`);
    assert.ok(weaknessOps.some((o) => String(o.data?.value).includes('silver, 5')), 'silver weakness must keep "name, amount" format');

    const senseOps = ops.filter((o) => o.type === 'adjValue' && o.data?.variable === 'SENSES_IMPRECISE');
    assert.strictEqual(senseOps.length, 1, `"lifesense, 60" is one sense and must NOT be split (got ${senseOps.length})`);
    assert.strictEqual(senseOps[0]?.data?.value, 'lifesense, 60', 'sense value must be "lifesense, 60"');

    // Clean up
    await deleteEncounter({ id: encId });
  });
});

describe('create_encounter + update_encounter + delete_encounter', () => {
  test('full lifecycle: create with creature, update meta, fetch, delete', { timeout: TIMEOUT * 4 }, async () => {
    const campaigns = await findCampaign({});
    const idMatch = campaigns.match(/\(ID:\s*(\d+)\)/);
    if (!idMatch) {
      console.log('  (skipped: no campaigns found)');
      return;
    }
    const campaignId = parseInt(idMatch[1], 10);

    // Create
    const created = await createEncounter({
      campaign_id: campaignId,
      name: `Integration Test ${Date.now()}`,
      description: 'Lifecycle test description.',
      party_level: 5,
      party_size: 4,
      enemy_creatures: [{ id: 10123, adjustment: 'WEAK' }], // Weak Harpy
    });
    assertIsString(created, 'create_encounter');
    assert.match(created, /created successfully/i);
    assert.match(created, /1 combatant/i);
    const encId = parseInt(created.match(/\(ID:\s*(\d+)\)/)![1], 10);

    // Fetch and verify description + combatant
    const fetched = await findEncounter({ id: encId });
    assertIsString(fetched, 'find_encounter(created)');
    assert.ok(fetched.includes('Lifecycle test description'), `description must round-trip\nGot: ${fetched}`);
    assert.ok(fetched.includes('Harpy'), `combatant must appear\nGot: ${fetched}`);
    assert.ok(fetched.includes('weak'), `WEAK adjustment must appear\nGot: ${fetched}`);

    // Update
    const updated = await updateEncounter({ id: encId, party_size: 6 });
    assertIsString(updated, 'update_encounter');
    assert.match(updated, /updated successfully/i);

    // Delete
    const deleted = await deleteEncounter({ id: encId });
    assertIsString(deleted, 'delete_encounter');
    assert.match(deleted, /deleted successfully/i);
  });
});
