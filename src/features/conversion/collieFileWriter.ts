import { TextDecoder, TextEncoder } from 'util';
import { Uri, workspace } from 'vscode';

export interface CollieWriteResult {
  uri: Uri;
  idLine: number;
  wasCreated: boolean;
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
