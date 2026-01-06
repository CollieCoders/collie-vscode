import * as path from 'path';
import type { Uri, TextDocument } from 'vscode';

export const COLLIE_GLOB = '**/*.collie';
export const COLLIE_EXCLUDE_GLOB = '**/{node_modules,dist,build,out,coverage,.git}/**';
const EXCLUDED_DIR_NAMES = ['node_modules', 'dist', 'build', 'out', 'coverage', '.git'];

export function isExcludedPath(fsPath: string): boolean {
  for (const name of EXCLUDED_DIR_NAMES) {
    if (fsPath.includes(`${path.sep}${name}${path.sep}`)) {
      return true;
    }
  }
  return false;
}

export function isCollieUri(uri: Uri): boolean {
  return uri.fsPath.endsWith('.collie') && !isExcludedPath(uri.fsPath);
}

export function isCollieDocument(document: TextDocument): boolean {
  return document.languageId === 'collie' || isCollieUri(document.uri);
}
