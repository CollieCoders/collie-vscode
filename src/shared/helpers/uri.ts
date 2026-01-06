import type { TextDocument, Uri } from 'vscode';

/**
 * Returns a canonical key for a document or URI.
 * Uses uri.toString() to ensure consistent keying across the codebase.
 * 
 * @param documentOrUri - A TextDocument or Uri to generate a key for
 * @returns A string key that can be used in Maps or Sets
 */
export function getDocumentKey(documentOrUri: TextDocument | Uri): string {
  if ('uri' in documentOrUri) {
    return documentOrUri.uri.toString();
  }
  return documentOrUri.toString();
}

/**
 * Returns a canonical file path for a URI.
 * Use this when you need the file system path (not suitable for non-file schemes).
 * 
 * @param uri - The URI to get the file path from
 * @returns The file system path
 */
export function getFilePath(uri: Uri): string {
  return uri.fsPath;
}
