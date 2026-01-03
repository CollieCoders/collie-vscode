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

export interface CollieTemplateBlock {
  id: string;
  idLine: number;
}

interface TemplateBlockRange extends CollieTemplateBlock {
  contentStartLine: number;
  contentEndLine: number;
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

function parseTemplateBlockRanges(contents: string): TemplateBlockRange[] {
  const lines = contents.split(/\r?\n/);
  const blocks: TemplateBlockRange[] = [];
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
    const contentStartLine = entry.line + 1;
    const contentEndLine = next ? next.line : lines.length;
    blocks.push({
      id: entry.id,
      idLine: entry.line,
      contentStartLine,
      contentEndLine
    });
  }

  return blocks;
}

function getLineStartOffsets(text: string): number[] {
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

export async function listTemplateBlocks(uri: Uri): Promise<CollieTemplateBlock[]> {
  if (!(await fileExists(uri))) {
    return [];
  }

  const bytes = await workspace.fs.readFile(uri);
  const contents = textDecoder.decode(bytes);
  return parseTemplateBlocks(contents).map(block => ({
    id: block.id,
    idLine: block.idLine
  }));
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

export async function appendToTemplateBlock(
  targetUri: Uri,
  templateId: string,
  collieText: string,
  fallbackEol: string
): Promise<CollieWriteResult | null> {
  if (!collieText.trim()) {
    return null;
  }

  if (!(await fileExists(targetUri))) {
    return null;
  }

  const bytes = await workspace.fs.readFile(targetUri);
  const existingText = textDecoder.decode(bytes);
  const eol = resolveEol(existingText, fallbackEol);
  const blocks = parseTemplateBlockRanges(existingText);
  const block = blocks.find(entry => entry.id === templateId);

  if (!block) {
    return null;
  }

  const lines = existingText.split(/\r?\n/);
  const contentLines = lines.slice(block.contentStartLine, block.contentEndLine);
  let lastNonEmpty = -1;
  for (let i = contentLines.length - 1; i >= 0; i -= 1) {
    if (contentLines[i].trim().length) {
      lastNonEmpty = i;
      break;
    }
  }

  const hasBlankLine =
    contentLines.length > 0 && (lastNonEmpty === -1 || lastNonEmpty < contentLines.length - 1);
  const prefix = hasBlankLine ? '' : eol;
  const body = collieText.trimEnd();
  const insertion = `${prefix}${body}${eol}`;

  const lineStarts = getLineStartOffsets(existingText);
  const insertionOffset =
    block.contentEndLine < lineStarts.length ? lineStarts[block.contentEndLine] : existingText.length;
  const nextText =
    existingText.slice(0, insertionOffset) + insertion + existingText.slice(insertionOffset);

  await workspace.fs.writeFile(targetUri, textEncoder.encode(nextText));

  return {
    uri: targetUri,
    idLine: block.idLine,
    wasCreated: false
  };
}
