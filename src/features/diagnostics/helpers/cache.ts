import { workspace } from 'vscode';
import { listByFile, type TemplateLocation } from '../../../lang/templateIndex';

const COLLIE_GLOB = '**/*.collie';
const COLLIE_EXCLUDE_GLOB = '**/{node_modules,dist,build,out,coverage,.git}/**';

let templateIndexVersion = 0;
let cachedTemplateEntriesVersion = -1;
let cachedTemplateEntries: Map<string, TemplateLocation[]> = new Map();
let cachedTemplateEntriesPromise: Promise<Map<string, TemplateLocation[]>> | null = null;

export function invalidateTemplateEntryCache(): void {
  templateIndexVersion += 1;
  cachedTemplateEntriesVersion = -1;
  cachedTemplateEntries.clear();
  cachedTemplateEntriesPromise = null;
}

export async function getTemplateEntriesById(): Promise<Map<string, TemplateLocation[]>> {
  if (cachedTemplateEntriesVersion === templateIndexVersion) {
    return cachedTemplateEntries;
  }

  if (cachedTemplateEntriesPromise) {
    return cachedTemplateEntriesPromise;
  }

  cachedTemplateEntriesPromise = (async () => {
    const entriesById = new Map<string, TemplateLocation[]>();
    const files = await workspace.findFiles(COLLIE_GLOB, COLLIE_EXCLUDE_GLOB);

    for (const uri of files) {
      const entries = listByFile(uri);
      for (const entry of entries) {
        const existing = entriesById.get(entry.id) ?? [];
        existing.push(entry);
        entriesById.set(entry.id, existing);
      }
    }

    cachedTemplateEntries = entriesById;
    cachedTemplateEntriesVersion = templateIndexVersion;
    cachedTemplateEntriesPromise = null;
    return entriesById;
  })();

  return cachedTemplateEntriesPromise;
}
