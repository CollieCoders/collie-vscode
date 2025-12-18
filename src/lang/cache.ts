import type { TextDocument, Uri } from 'vscode';
import type { ParsedDocument } from '.';
import { parseCollieDocument } from './parseDocument';

interface CacheEntry {
  version: number;
  parsed: ParsedDocument;
}

const documentCache = new Map<string, CacheEntry>();

function toCacheKey(documentOrUri: TextDocument | Uri): string {
  if ('uri' in documentOrUri) {
    return documentOrUri.uri.toString();
  }
  return documentOrUri.toString();
}

function getEntry(document: TextDocument): CacheEntry | undefined {
  return documentCache.get(document.uri.toString());
}

export function getParsedDocument(document: TextDocument): ParsedDocument {
  const cached = getEntry(document);
  if (cached && cached.version === document.version) {
    return cached.parsed;
  }

  const parsed = parseCollieDocument(document);
  documentCache.set(document.uri.toString(), {
    version: document.version,
    parsed
  });
  return parsed;
}

export function invalidateParsedDocument(documentOrUri: TextDocument | Uri): void {
  documentCache.delete(toCacheKey(documentOrUri));
}

export function clearParsedDocuments(): void {
  documentCache.clear();
}
