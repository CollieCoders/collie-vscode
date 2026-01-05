import { Uri, workspace } from 'vscode';
import type { CollieWriteResult, CollieTemplateMatch, CollieTemplateBlock } from './types';
import {
  fileExists,
  readFileAsText,
  writeFileAsText,
  normalizeForMatch,
  resolveEol,
  countNewlines,
  getLineStartOffsets
} from './helpers';

interface TemplateBlockRange extends CollieTemplateBlock {
  contentStartLine: number;
  contentEndLine: number;
}

const PROP_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

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

export async function findMatchingTemplates(
  uri: Uri,
  collieText: string
): Promise<CollieTemplateMatch[]> {
  if (!(await fileExists(uri))) {
    return [];
  }

  const contents = await readFileAsText(uri);
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

  const contents = await readFileAsText(uri);
  return parseTemplateBlocks(contents).map(block => ({
    id: block.id,
    idLine: block.idLine
  }));
}

interface PropInfo {
  name: string;
  kind: 'fn' | 'value';
}

function normalizePropNames(propKinds: Map<string, { kind: 'fn' | 'value' }>): PropInfo[] {
  const seen = new Set<string>();
  const normalized: PropInfo[] = [];
  for (const [name, info] of propKinds.entries()) {
    const trimmed = name.trim();
    if (!trimmed || !PROP_NAME_PATTERN.test(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push({ name: trimmed, kind: info.kind });
  }
  return normalized;
}

function buildPropsBlock(props: PropInfo[], eol: string): string {
  if (props.length === 0) {
    return '';
  }
  const lines = [
    '#props',
    ...props.map(prop => `  ${prop.name}${prop.kind === 'fn' ? '()' : ''}`)
  ];
  return lines.join(eol);
}

function buildTemplateBlock(
  templateId: string,
  collieText: string,
  eol: string,
  props: PropInfo[]
): string {
  const body = collieText.trimEnd();
  const propsBlock = buildPropsBlock(props, eol);
  const parts: string[] = [`#id ${templateId}`];
  if (propsBlock) {
    parts.push('', propsBlock, '');
  }
  if (body) {
    if (!propsBlock) {
      parts.push('');
    }
    parts.push(body);
  }
  parts.push('');
  return parts.join(eol);
}

export async function writeTemplateBlock(
  targetUri: Uri,
  templateId: string,
  collieText: string,
  fallbackEol: string,
  propKinds: Map<string, { kind: 'fn' | 'value' }> = new Map()
): Promise<CollieWriteResult> {
  const exists = await fileExists(targetUri);
  let existingText = '';

  if (exists) {
    existingText = await readFileAsText(targetUri);
  }

  const eol = resolveEol(existingText, fallbackEol);
  const normalizedProps = normalizePropNames(propKinds);
  const block = buildTemplateBlock(templateId, collieText, eol, normalizedProps);

  let nextText: string;
  let idLine = 0;

  if (existingText.trim().length === 0) {
    nextText = block;
  } else {
    const trimmed = existingText.trimEnd();
    const prefix = `${trimmed}${eol}${eol}`;
    idLine = countNewlines(prefix);
    nextText = `${prefix}${block}`;
  }

  await writeFileAsText(targetUri, nextText);

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

  const existingText = await readFileAsText(targetUri);
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

  await writeFileAsText(targetUri, nextText);

  return {
    uri: targetUri,
    idLine: block.idLine,
    wasCreated: false
  };
}

export async function updateTemplateBlockProps(
  targetUri: Uri,
  templateId: string,
  propKinds: Map<string, { kind: 'fn' | 'value' }>,
  fallbackEol: string
): Promise<boolean> {
  const normalizedProps = normalizePropNames(propKinds);
  if (normalizedProps.length === 0) {
    return false;
  }

  if (!(await fileExists(targetUri))) {
    return false;
  }

  const existingText = await readFileAsText(targetUri);
  const eol = resolveEol(existingText, fallbackEol);
  const blocks = parseTemplateBlockRanges(existingText);
  const block = blocks.find(entry => entry.id === templateId);

  if (!block) {
    return false;
  }

  const lines = existingText.split(/\r?\n/);
  const propsStart = findPropsBlockStart(lines, block.contentStartLine, block.contentEndLine);

  if (propsStart === null) {
    const insertion = buildPropsBlock(normalizedProps, eol)
      .split(eol);
    if (insertion.length === 0) {
      return false;
    }
    const prefixBlank = block.contentStartLine > 0 && lines[block.contentStartLine - 1].trim().length > 0;
    const suffixBlank = block.contentStartLine < lines.length && lines[block.contentStartLine].trim().length > 0;
    const insertLines: string[] = [];
    if (prefixBlank) {
      insertLines.push('');
    }
    insertLines.push(...insertion);
    if (suffixBlank) {
      insertLines.push('');
    }
    lines.splice(block.contentStartLine, 0, ...insertLines);
  } else {
    const propsEnd = findPropsBlockEnd(lines, propsStart, block.contentEndLine);
    const existingProps = collectPropsFromBlock(lines, propsStart, propsEnd);
    const missing = normalizedProps.filter(prop => !existingProps.has(prop.name));
    if (missing.length === 0) {
      return false;
    }
    const insertion = missing.map(prop => `  ${prop.name}${prop.kind === 'fn' ? '()' : ''}`);
    lines.splice(propsEnd, 0, ...insertion);
  }

  const nextText = lines.join(eol);
  await writeFileAsText(targetUri, nextText);
  return true;
}

function findPropsBlockStart(
  lines: string[],
  startLine: number,
  endLine: number
): number | null {
  for (let i = startLine; i < endLine; i += 1) {
    const line = lines[i];
    if (line.trim() !== '#props') {
      continue;
    }
    if (line.match(/^\s*#props\s*$/)) {
      return i;
    }
  }
  return null;
}

function findPropsBlockEnd(lines: string[], propsStart: number, endLine: number): number {
  const propsIndent = (lines[propsStart].match(/^\s*/)?.[0].length ?? 0);
  for (let i = propsStart + 1; i < endLine; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) {
      continue;
    }
    const indent = (line.match(/^\s*/)?.[0].length ?? 0);
    if (indent <= propsIndent) {
      return i;
    }
  }
  return endLine;
}

function collectPropsFromBlock(lines: string[], propsStart: number, propsEnd: number): Set<string> {
  const propsIndent = (lines[propsStart].match(/^\s*/)?.[0].length ?? 0);
  const props = new Set<string>();
  for (let i = propsStart + 1; i < propsEnd; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    const indent = (line.match(/^\s*/)?.[0].length ?? 0);
    if (indent <= propsIndent) {
      break;
    }
    // Try new syntax: name or name()
    const newMatch = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\(\)?$/);
    if (newMatch) {
      props.add(newMatch[1]);
      continue;
    }
    // Try legacy syntax: name?: type or name: type
    const legacyMatch = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(\??)?\s*:/);
    if (legacyMatch) {
      props.add(legacyMatch[1]);
    }
  }
  return props;
}
