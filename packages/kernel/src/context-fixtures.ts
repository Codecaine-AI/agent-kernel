import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ContextFixture {
  id: string;
  label: string;
  variables: Record<string, unknown>;
  sessionData: Record<string, unknown>;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Catalog previews only. Live agent spawning never reads fixture files. */
export function discoverContextFixtures(bundleDir: string): ContextFixture[] {
  const dir = join(bundleDir, 'context/fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isFile() || !entry.name.endsWith('.json')) return [];
    try {
      const data: unknown = JSON.parse(readFileSync(join(dir, entry.name), 'utf8'));
      if (!object(data) || !object(data.sessionData) || (data.variables !== undefined && !object(data.variables))) return [];
      const id = entry.name.slice(0, -5);
      return [{ id, label: typeof data.label === 'string' && data.label.trim() ? data.label : id,
        variables: object(data.variables) ? data.variables : {}, sessionData: data.sessionData }];
    } catch { return []; }
  }).sort((a, b) => a.id.localeCompare(b.id));
}
