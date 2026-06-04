import { wgFetch } from '../client.js';

interface Campaign {
  id?: number;
  name?: string;
  description?: string;
  members?: string[];
  [key: string]: unknown;
}

function formatCampaign(c: Campaign): string {
  const lines: string[] = [];
  if (c.name) lines.push(`**${c.name}**${c.id !== undefined ? ` (ID: ${c.id})` : ''}`);
  if (c.members?.length) lines.push(`Members: ${c.members.join(', ')}`);
  if (c.description) lines.push(`\n${c.description}`);
  return lines.join('\n');
}

export async function findCampaign(args: {
  id?: number;
  name?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.name) body.name = args.name;

  const results = await wgFetch<Campaign[]>('find-campaign', body);

  if (!results || results.length === 0) {
    const term = args.name ?? String(args.id) ?? 'your account';
    return `No campaigns found matching "${term}".`;
  }

  return results.map(formatCampaign).join('\n\n---\n\n');
}
