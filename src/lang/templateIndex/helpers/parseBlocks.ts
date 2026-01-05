import type { Uri } from 'vscode';
import { Position, Range } from 'vscode';
import type { TemplateLocation } from '../types';

const TEMPLATE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

function getLineLength(lines: string[], lineIndex: number): number {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return 0;
  }
  return lines[lineIndex].length;
}

export function parseTemplateBlocks(contents: string, uri: Uri): TemplateLocation[] {
  const lines = contents.split(/\r?\n/);
  const idLines: { id: string; line: number; isValidId: boolean }[] = [];

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

    idLines.push({
      id,
      line: i,
      isValidId: TEMPLATE_ID_PATTERN.test(id)
    });
  }

  if (idLines.length === 0) {
    return [];
  }

  const locations: TemplateLocation[] = [];

  for (let i = 0; i < idLines.length; i += 1) {
    const entry = idLines[i];
    const next = idLines[i + 1];
    const blockEndLine = next ? next.line : Math.max(lines.length - 1, entry.line);
    const blockEndChar = next ? 0 : getLineLength(lines, blockEndLine);

    const idRange = new Range(
      new Position(entry.line, 0),
      new Position(entry.line, getLineLength(lines, entry.line))
    );

    const blockRange = new Range(
      new Position(entry.line, 0),
      new Position(blockEndLine, blockEndChar)
    );

    locations.push({
      id: entry.id,
      uri,
      idRange,
      blockRange,
      isValidId: entry.isValidId
    });
  }

  return locations;
}
