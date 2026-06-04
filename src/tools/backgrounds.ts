import { wgFetch } from '../client.js';

interface Background {
  id?: number;
  name?: string;
  boosts?: string[];
  skills?: string[];
  feats?: string[];
  description?: string;
  [key: string]: unknown;
}

function formatBackground(b: Background): string {
  const lines: string[] = [];
  if (b.name) lines.push(`**${b.name}**`);
  if (b.boosts?.length) lines.push(`Ability Boosts: ${b.boosts.join(', ')}`);
  if (b.skills?.length) lines.push(`Trained Skills: ${b.skills.join(', ')}`);
  if (b.feats?.length) lines.push(`Feat Grants: ${b.feats.join(', ')}`);
  if (b.description) lines.push(`\n${b.description}`);
  return lines.join('\n');
}

export async function findBackground(args: {
  name?: string;
  id?: number | number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;

  const results = await wgFetch<Background[]>('find-background', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'given criteria';
    return `No backgrounds found matching "${term}".`;
  }

  return results.map(formatBackground).join('\n\n---\n\n');
}
