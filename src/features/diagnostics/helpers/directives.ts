export const SUPPORTED_DIRECTIVES = new Set(['@if', '@elseIf', '@else', '@for']);
export const DIALECT_DIRECTIVE_ALIASES = new Set(['@elseif', '@else-if']);

const FILE_IGNORE_PATTERNS = [
  /^\s*\/\/\s*collie-ignore-file\s+(.+?)\s*$/,
  /^\s*#collie-ignore-file\s+(.+?)\s*$/
];
const LINE_IGNORE_PATTERNS = [
  /^\s*\/\/\s*collie-ignore-next-line\s+(.+?)\s*$/,
  /^\s*#collie-ignore-next-line\s+(.+?)\s*$/
];

function matchIgnorePattern(line: string, patterns: RegExp[]): RegExpExecArray | null {
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) {
      return match;
    }
  }
  return null;
}

function isIgnoreDirectiveLine(line: string): boolean {
  return FILE_IGNORE_PATTERNS.some(pattern => pattern.test(line)) ||
    LINE_IGNORE_PATTERNS.some(pattern => pattern.test(line));
}

function isCommentLine(line: string): boolean {
  return /^\s*\/\//.test(line);
}

export interface IgnoreDirectives {
  fileLevelCodes: Set<string>;
  lineLevelCodes: Map<number, Set<string>>;
}

/**
 * Parse ignore directives from a document.
 * Returns file-level codes and a map of line numbers to codes that should be ignored on that line.
 */
export function parseIgnoreDirectives(documentText: string): IgnoreDirectives {
  const fileLevelCodes = new Set<string>();
  const lineLevelCodes = new Map<number, Set<string>>();
  const lines = documentText.split(/\r?\n/);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber];

    // Check for file-level ignore
    const fileMatch = matchIgnorePattern(line, FILE_IGNORE_PATTERNS);
    if (fileMatch) {
      const codes = fileMatch[1].trim().split(/\s+/);
      for (const code of codes) {
        if (code) {
          fileLevelCodes.add(code);
        }
      }
      continue;
    }

    // Check for line-level ignore (applies to next non-directive line)
    const lineMatch = matchIgnorePattern(line, LINE_IGNORE_PATTERNS);
    if (lineMatch) {
      const codes = lineMatch[1].trim().split(/\s+/);
      const codeSet = new Set<string>();
      for (const code of codes) {
        if (code) {
          codeSet.add(code);
        }
      }

      // Find the next non-directive, non-comment line
      let targetLine = lineNumber + 1;
      while (targetLine < lines.length) {
        const nextLine = lines[targetLine];
        if (isIgnoreDirectiveLine(nextLine) || isCommentLine(nextLine) || nextLine.trim().length === 0) {
          targetLine++;
          continue;
        }
        break;
      }

      if (targetLine < lines.length) {
        lineLevelCodes.set(targetLine, codeSet);
      }
    }
  }

  return { fileLevelCodes, lineLevelCodes };
}
