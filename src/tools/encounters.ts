import { wgFetch } from '../client.js';

interface Encounter {
  id?: number;
  name?: string;
  campaign_id?: number;
  description?: string;
  combatants?: Array<{ name?: string; level?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

function formatEncounter(e: Encounter): string {
  const lines: string[] = [];
  if (e.name) lines.push(`**${e.name}**${e.id !== undefined ? ` (ID: ${e.id})` : ''}`);
  if (e.campaign_id !== undefined) lines.push(`Campaign ID: ${e.campaign_id}`);
  if (e.description) lines.push(e.description);
  if (e.combatants?.length) {
    lines.push(`Combatants:`);
    for (const c of e.combatants) {
      const parts = [c.name ?? 'Unknown', c.level !== undefined ? `Level ${c.level}` : null].filter(Boolean);
      lines.push(`  - ${parts.join(' ')}`);
    }
  }
  return lines.join('\n');
}

export async function findEncounter(args: {
  id?: number;
  campaign_id?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.campaign_id !== undefined) body.campaign_id = args.campaign_id;

  const results = await wgFetch<Encounter[]>('find-encounter', body);

  if (!results || results.length === 0) {
    return `No encounters found.`;
  }

  return results.map(formatEncounter).join('\n\n---\n\n');
}

export async function createEncounter(args: {
  campaign_id: number;
  name: string;
  description?: string;
  combatants?: unknown[];
}): Promise<string> {
  const body: Record<string, unknown> = {
    campaign_id: args.campaign_id,
    name: args.name,
  };
  if (args.description) body.description = args.description;
  if (args.combatants) body.combatants = args.combatants;

  const result = await wgFetch<Encounter>('create-encounter', body);

  const name = result?.name ?? args.name;
  const id = result?.id;
  return `Encounter "${name}" created successfully${id !== undefined ? ` (ID: ${id})` : ''}.`;
}
