export const ELEMENT_NAME = /^[A-Za-z][A-Za-z0-9_-]*/;
export const CLASS_TOKEN = /^(?:[A-Za-z0-9_-]+|\$[A-Za-z_][A-Za-z0-9_-]*)/;

export function hasTopLevelAssignment(payload: string): boolean {
  let quote: '"' | "'" | '`' | null = null;
  let braceDepth = 0;
  let parenDepth = 0;
  let escapeNext = false;

  for (let i = 0; i < payload.length; i++) {
    const ch = payload[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      continue;
    }
    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (ch === '(') {
      parenDepth += 1;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === '=' && braceDepth === 0 && parenDepth === 0) {
      return true;
    }
  }

  return false;
}

export function looksLikeAttributePayload(payload: string): boolean {
  if (!payload) {
    return false;
  }
  if (payload.startsWith('(')) {
    return true;
  }
  return hasTopLevelAssignment(payload);
}

export function findMatchingParen(source: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escapeNext = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
      continue;
    }
  }

  return -1;
}
