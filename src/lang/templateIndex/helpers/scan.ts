import type { Uri} from 'vscode';
import { workspace } from 'vscode';
import { TextDecoder } from 'util';
import type { TemplateLocation } from '../types';
import { COLLIE_GLOB, COLLIE_EXCLUDE_GLOB, isCollieUri } from './exclude';
import { parseTemplateBlocks } from './parseBlocks';

const MAX_SCAN_CONCURRENCY = 8;
const textDecoder = new TextDecoder('utf-8');

export async function updateTemplateIndexFromDisk(
  uri: Uri,
  setEntriesForUri: (uri: Uri, entries: TemplateLocation[]) => void,
  removeEntriesForUri: (uri: Uri) => void
): Promise<void> {
  if (!isCollieUri(uri)) {
    return;
  }

  try {
    const data = await workspace.fs.readFile(uri);
    const contents = textDecoder.decode(data);
    const entries = parseTemplateBlocks(contents, uri);
    setEntriesForUri(uri, entries);
  } catch {
    removeEntriesForUri(uri);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const cappedLimit = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  const workers = Array.from({ length: cappedLimit }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await task(items[current]);
    }
  });

  await Promise.all(workers);
}

export async function scanWorkspaceTemplates(
  clearIndex: () => void,
  updateFromDisk: (uri: Uri) => Promise<void>
): Promise<void> {
  clearIndex();
  const files = await workspace.findFiles(COLLIE_GLOB, COLLIE_EXCLUDE_GLOB);
  const collieFiles = files.filter(isCollieUri);
  await runWithConcurrency(collieFiles, MAX_SCAN_CONCURRENCY, updateFromDisk);
}
