import { wgFetch } from '../client.js';

interface AbilityBlock {
  id?: number;
  name?: string;
  type?: string;
  level?: number;
  traits?: string[];
  prerequisites?: string;
  frequency?: string;
  trigger?: string;
  requirements?: string;
  description?: string;
  [key: string]: unknown;
}

function formatAbility(a: AbilityBlock): string {
  const lines: string[] = [];
  const header = [a.name, a.type ? `[${a.type}]` : null, a.level !== undefined ? `Level ${a.level}` : null]
    .filter(Boolean)
    .join(' ');
  if (header) lines.push(`**${header}**`);
  if (a.traits?.length) lines.push(`Traits: ${a.traits.join(', ')}`);
  if (a.prerequisites) lines.push(`Prerequisites: ${a.prerequisites}`);
  if (a.frequency) lines.push(`Frequency: ${a.frequency}`);
  if (a.trigger) lines.push(`Trigger: ${a.trigger}`);
  if (a.requirements) lines.push(`Requirements: ${a.requirements}`);
  if (a.description) lines.push(`\n${a.description}`);
  return lines.join('\n');
}

export async function findFeat(args: {
  name?: string;
  id?: number | number[];
  type?: string;
  traits?: string[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.type) body.type = args.type;
  if (args.traits?.length) body.traits = args.traits;

  const results = await wgFetch<AbilityBlock[]>('find-ability-block', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No feats or abilities found matching "${term}".`;
  }

  return results.map(formatAbility).join('\n\n---\n\n');
}
