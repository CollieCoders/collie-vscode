import { workspace } from 'vscode';
import { TextDecoder } from 'util';
import type { TextDocument } from 'vscode';
import { getTextPreferOpenDoc } from './textHelpers';

const TEMPLATE_USAGE_GLOB = '**/*.{ts,tsx,js,jsx,html}';
const TEMPLATE_USAGE_EXCLUDE_GLOB = '**/{node_modules,dist,build,out,coverage,.git}/**';
const COLLIE_COMPONENT_PATTERN = /<Collie\b[^>]*\bid\s*=\s*["']([^"']+)["']/g;
const HTML_PLACEHOLDER_PATTERN = /\bid\s*=\s*["']([^"']*-collie)["']/g;
const textDecoder = new TextDecoder('utf-8');

let templateUsageVersion = 0;
let cachedTemplateUsageVersion = -1;
let cachedReferencedIds: Set<string> = new Set();
let cachedReferencedIdsPromise: Promise<Set<string>> | null = null;

export function invalidateTemplateUsageCache(): void {
  templateUsageVersion += 1;
  cachedTemplateUsageVersion = -1;
  cachedReferencedIds.clear();
  cachedReferencedIdsPromise = null;
}

export function isTemplateUsageDocument(document: TextDocument): boolean {
  if (document.uri.scheme !== 'file') {
    return false;
  }
  const languageId = document.languageId;
  if (
    languageId === 'typescript' ||
    languageId === 'typescriptreact' ||
    languageId === 'javascript' ||
    languageId === 'javascriptreact' ||
    languageId === 'html'
  ) {
    return true;
  }
  return document.fileName.endsWith('.html');
}

export async function getReferencedTemplateIds(): Promise<Set<string>> {
  if (cachedTemplateUsageVersion === templateUsageVersion) {
    return cachedReferencedIds;
  }

  if (cachedReferencedIdsPromise) {
    return cachedReferencedIdsPromise;
  }

  cachedReferencedIdsPromise = (async () => {
    const referenced = new Set<string>();
    const files = await workspace.findFiles(TEMPLATE_USAGE_GLOB, TEMPLATE_USAGE_EXCLUDE_GLOB);

    for (const uri of files) {
      let contents = '';
      try {
        // diagnostic-upgrade: Prefer open document buffers over disk reads
        // This allows unreferenced template warnings to clear when adding <Collie id="..."/> in unsaved TSX
        contents = await getTextPreferOpenDoc(uri);
      } catch {
        continue;
      }

      let match: RegExpExecArray | null;
      const componentRegex = new RegExp(COLLIE_COMPONENT_PATTERN.source, 'g');
      while ((match = componentRegex.exec(contents)) !== null) {
        const id = match[1]?.trim();
        if (id) {
          referenced.add(id);
        }
      }

      const htmlRegex = new RegExp(HTML_PLACEHOLDER_PATTERN.source, 'g');
      while ((match = htmlRegex.exec(contents)) !== null) {
        const raw = match[1]?.trim();
        if (!raw?.endsWith('-collie')) {
          continue;
        }
        const logicalId = raw.slice(0, -7);
        if (logicalId) {
          referenced.add(logicalId);
        }
      }
    }

    cachedReferencedIds = referenced;
    cachedTemplateUsageVersion = templateUsageVersion;
    cachedReferencedIdsPromise = null;
    return referenced;
  })();

  return cachedReferencedIdsPromise;
}
