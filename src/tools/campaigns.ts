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
  id?: number | number[];
  user_id?: string;
  join_key?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.user_id) body.user_id = args.user_id;
  if (args.join_key) body.join_key = args.join_key;

  const results = await wgFetch<Campaign[]>('find-campaign', body);

  if (!results || results.length === 0) {
    const term = args.id !== undefined ? `ID ${args.id}` : 'your account';
    return `No campaigns found for ${term}.`;
  }

  return results.map(formatCampaign).join('\n\n---\n\n');
}
