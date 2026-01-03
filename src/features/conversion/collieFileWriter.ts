import { TextDecoder, TextEncoder } from 'util';
import { Uri, workspace } from 'vscode';

export interface CollieWriteResult {
  uri: Uri;
  idLine: number;
  wasCreated: boolean;
}

export interface CollieTemplateMatch {
  id: string;
  idLine: number;
  content: string;
}

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

async function fileExists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '');
}

function parseTemplateBlocks(contents: string): CollieTemplateMatch[] {
  const lines = contents.split(/\r?\n/);
  const matches: CollieTemplateMatch[] = [];

  const idLines: Array<{ id: string; line: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^\s*#id\s+([^\s]+)/);
    if (!match) {
      continue;
    }
    const id = match[1].trim();
    if (!id) {
      continue;
    }
    idLines.push({ id, line: i });
  }

  for (let i = 0; i < idLines.length; i += 1) {
    const entry = idLines[i];
    const next = idLines[i + 1];
    const contentStart = entry.line + 1;
    const contentEnd = next ? next.line : lines.length;
    const content = lines.slice(contentStart, contentEnd).join('\n').trimEnd();
    matches.push({ id: entry.id, idLine: entry.line, content });
  }

  return matches;
}

export async function findMatchingTemplates(
  uri: Uri,
  collieText: string
): Promise<CollieTemplateMatch[]> {
  if (!(await fileExists(uri))) {
    return [];
  }

  const bytes = await workspace.fs.readFile(uri);
  const contents = textDecoder.decode(bytes);
  const trimmedSelection = collieText.trim();
  if (!trimmedSelection) {
    return [];
  }
  const normalizedSelection = normalizeForMatch(trimmedSelection);

  const matches: CollieTemplateMatch[] = [];
  for (const block of parseTemplateBlocks(contents)) {
    const trimmedBlock = block.content.trim();
    if (!trimmedBlock) {
      continue;
    }
    if (trimmedBlock === trimmedSelection) {
      matches.push(block);
      continue;
    }
    if (normalizeForMatch(trimmedBlock) === normalizedSelection) {
      matches.push(block);
    }
  }

  return matches;
}

function countNewlines(text: string): number {
  const matches = text.match(/\r?\n/g);
  return matches ? matches.length : 0;
}

function resolveEol(existingText: string, fallback: string): string {
  return existingText.includes('\r\n') ? '\r\n' : fallback;
}

function buildTemplateBlock(templateId: string, collieText: string, eol: string): string {
  const body = collieText.trimEnd();
  if (!body) {
    return `#id ${templateId}`;
  }
  return `#id ${templateId}${eol}${eol}${body}`;
}

export async function writeTemplateBlock(
  targetUri: Uri,
  templateId: string,
  collieText: string,
  fallbackEol: string
): Promise<CollieWriteResult> {
  const exists = await fileExists(targetUri);
  let existingText = '';

  if (exists) {
    const bytes = await workspace.fs.readFile(targetUri);
    existingText = textDecoder.decode(bytes);
  }

  const eol = resolveEol(existingText, fallbackEol);
  const block = buildTemplateBlock(templateId, collieText, eol);

  let nextText: string;
  let idLine = 0;

  if (existingText.trim().length === 0) {
    nextText = `${block}${eol}`;
  } else {
    const trimmed = existingText.trimEnd();
    const prefix = `${trimmed}${eol}${eol}`;
    idLine = countNewlines(prefix);
    nextText = `${prefix}${block}${eol}`;
  }

  await workspace.fs.writeFile(targetUri, textEncoder.encode(nextText));

  return {
    uri: targetUri,
    idLine,
    wasCreated: !exists
  };
}
