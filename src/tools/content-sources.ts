import { wgFetch } from '../client.js';

interface ContentSource {
  id?: number;
  name?: string;
  url?: string;
  group?: string;
  homebrew?: boolean;
  published?: boolean;
  foundry_id?: string;
  [key: string]: unknown;
}

interface ContentUpdate {
  id?: number;
  type?: string;
  action?: string;
  state?: string;
  content_source_id?: number;
  created_at?: string;
  [key: string]: unknown;
}

function formatContentSource(s: ContentSource): string {
  const lines: string[] = [];
  if (s.name) lines.push(`**${s.name}**${s.id !== undefined ? ` (ID: ${s.id})` : ''}`);
  const tags: string[] = [];
  if (s.group) tags.push(s.group);
  if (s.homebrew) tags.push('homebrew');
  if (s.published) tags.push('published');
  if (tags.length) lines.push(tags.join(' · '));
  if (s.url) lines.push(`URL: ${s.url}`);
  if (s.foundry_id) lines.push(`Foundry ID: ${s.foundry_id}`);
  return lines.join('\n');
}

function formatContentUpdate(u: ContentUpdate): string {
  const lines: string[] = [];
  const header = [
    u.action,
    u.type,
    u.id !== undefined ? `(ID: ${u.id})` : null,
  ].filter(Boolean).join(' ');
  if (header) lines.push(`**${header}**`);
  if (u.state) lines.push(`State: ${u.state}`);
  if (u.content_source_id !== undefined) lines.push(`Content Source ID: ${u.content_source_id}`);
  if (u.created_at) lines.push(`Created: ${u.created_at}`);
  return lines.join('\n');
}

export async function findContentSource(args: {
  id?: number | number[];
  foundry_id?: string;
  group?: string;
  homebrew?: boolean;
  published?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.foundry_id) body.foundry_id = args.foundry_id;
  if (args.group) body.group = args.group;
  if (args.homebrew !== undefined) body.homebrew = args.homebrew;
  if (args.published !== undefined) body.published = args.published;

  const results = await wgFetch<ContentSource[]>('find-content-source', body);

  if (!results || results.length === 0) {
    return `No content sources found matching the given criteria.`;
  }

  return results.map(formatContentSource).join('\n\n---\n\n');
}

export async function findContentUpdate(args: {
  id?: number;
  user_id?: string;
  state?: 'PENDING' | 'APPROVED' | 'REJECTED';
  created?: { from?: string; to?: string };
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.user_id) body.user_id = args.user_id;
  if (args.state) body.state = args.state;
  if (args.created) body.created = args.created;

  const results = await wgFetch<ContentUpdate[]>('find-content-update', body);

  if (!results || results.length === 0) {
    return `No content updates found matching the given criteria.`;
  }

  return results.map(formatContentUpdate).join('\n\n---\n\n');
}
