import type { TextDocument, Uri } from 'vscode';
import type { ParsedDocument } from '.';
import type { SourceSpan } from '../format/parser/diagnostics';
import { parseCollieDocument } from './parseDocument';
import * as path from 'path';

interface CacheEntry {
  version: number;
  parsed: ParsedDocument;
}

export interface TemplateIdEntry {
  id: string;
  rawId?: string;
  uri: Uri;
  idSpan?: SourceSpan;
  derivedFromFilename: boolean;
}

const documentCache = new Map<string, CacheEntry>();
const templateIdIndex = new Map<string, TemplateIdEntry[]>();

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
  
  // Update template ID index
  updateTemplateIdIndex(document, parsed);
  
  return parsed;
}

function updateTemplateIdIndex(document: TextDocument, parsed: ParsedDocument): void {
  const uri = document.uri;
  const uriString = uri.toString();
  
  // Remove old entries for this URI from the index
  for (const [id, entries] of templateIdIndex.entries()) {
    const filtered = entries.filter(entry => entry.uri.toString() !== uriString);
    if (filtered.length === 0) {
      templateIdIndex.delete(id);
    } else if (filtered.length !== entries.length) {
      templateIdIndex.set(id, filtered);
    }
  }
  
  // Determine the template ID for this document
  let templateId: string;
  let rawId: string | undefined;
  let idSpan: SourceSpan | undefined;
  let derivedFromFilename: boolean;
  
  if (parsed.ast.id) {
    // Explicit ID directive
    templateId = parsed.ast.id;
    rawId = parsed.ast.rawId;
    idSpan = parsed.ast.idSpan;
    derivedFromFilename = false;
  } else {
    // Derive from filename
    const basename = path.basename(uri.fsPath, '.collie');
    let normalized = basename;
    // Strip trailing -collie from filename too
    if (normalized.endsWith('-collie')) {
      normalized = normalized.slice(0, -7);
    }
    templateId = normalized;
    derivedFromFilename = true;
  }
  
  // Add to index
  const entry: TemplateIdEntry = {
    id: templateId,
    rawId,
    uri,
    idSpan,
    derivedFromFilename
  };
  
  const existing = templateIdIndex.get(templateId) || [];
  existing.push(entry);
  templateIdIndex.set(templateId, existing);
}

export function getTemplateIdEntries(id: string): TemplateIdEntry[] {
  return templateIdIndex.get(id) || [];
}

export function getAllTemplateIds(): Map<string, TemplateIdEntry[]> {
  return new Map(templateIdIndex);
}

export function invalidateParsedDocument(documentOrUri: TextDocument | Uri): void {
  const key = toCacheKey(documentOrUri);
  documentCache.delete(key);
  
  // Remove from template ID index
  for (const [id, entries] of templateIdIndex.entries()) {
    const filtered = entries.filter(entry => entry.uri.toString() !== key);
    if (filtered.length === 0) {
      templateIdIndex.delete(id);
    } else if (filtered.length !== entries.length) {
      templateIdIndex.set(id, filtered);
    }
  }
}

export function clearParsedDocuments(): void {
  documentCache.clear();
  templateIdIndex.clear();
}
