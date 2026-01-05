import { TextDecoder, TextEncoder } from 'util';
import { Uri, workspace } from 'vscode';

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export async function fileExists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function readFileAsText(uri: Uri): Promise<string> {
  const bytes = await workspace.fs.readFile(uri);
  return textDecoder.decode(bytes);
}

export async function writeFileAsText(uri: Uri, text: string): Promise<void> {
  await workspace.fs.writeFile(uri, textEncoder.encode(text));
}

export function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '');
}

export function resolveEol(existingText: string, fallback: string): string {
  return existingText.includes('\r\n') ? '\r\n' : fallback;
}

export function countNewlines(text: string): number {
  const matches = text.match(/\r?\n/g);
  return matches ? matches.length : 0;
}

export function getLineStartOffsets(text: string): number[] {
  const offsets: number[] = [0];
  let index = 0;

  while (index < text.length) {
    const ch = text[index];
    if (ch === '\r') {
      if (text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      offsets.push(index);
      continue;
    }
    if (ch === '\n') {
      index += 1;
      offsets.push(index);
      continue;
    }
    index += 1;
  }

  return offsets;
}
