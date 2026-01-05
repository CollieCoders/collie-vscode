import type { CollieSemanticToken, Segment } from '../types';

export function pushToken(tokens: CollieSemanticToken[], token: CollieSemanticToken) {
  if (token.length <= 0) {
    return;
  }
  tokens.push(token);
}

export function overlaps(segments: Segment[], start: number, length: number): boolean {
  if (length <= 0) {
    return true;
  }
  const end = start + length;
  return segments.some(segment => start < segment.end && end > segment.start);
}

export function clipTokenLength(segments: Segment[], start: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  const end = start + length;
  for (const segment of segments) {
    if (segment.end <= start) {
      continue;
    }
    if (segment.start <= start) {
      return 0;
    }
    if (segment.start < end) {
      return Math.max(0, segment.start - start);
    }
    break;
  }
  return length;
}

export function tokenizeEventHandlerKeysInAttrList(
  tokens: CollieSemanticToken[],
  line: number,
  lineText: string,
  attrStart: number,
  attrEnd: number,
  commentSegments: Segment[]
) {
  let inSingle = false;
  let inDouble = false;

  const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);

  for (let i = attrStart; i < attrEnd; i++) {
    const ch = lineText[i];

    // quote state
    if (!inDouble && ch === "'" && lineText[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && lineText[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    // Look for word boundary + "on" + Capital letter: onClick, onSubmit, onMouseEnter, etc.
    if (ch !== 'o') continue;
    if (lineText[i + 1] !== 'n') continue;

    const prev = i > 0 ? lineText[i - 1] : '';
    if (prev && isWordChar(prev)) continue; // not a word boundary

    const third = lineText[i + 2];
    if (!third || !/[A-Z]/.test(third)) continue; // require CamelCase event style

    // Consume identifier
    let j = i + 2; // points at the capital letter
    while (j < attrEnd && /[A-Za-z0-9_]/.test(lineText[j])) {
      j++;
    }

    // Skip whitespace
    let k = j;
    while (k < attrEnd && (lineText[k] === ' ' || lineText[k] === '\t')) k++;

    // Must be followed by '='
    if (k >= attrEnd || lineText[k] !== '=') continue;

    const start = i;
    const length = j - i; // exclude '='
    if (!overlaps(commentSegments, start, length)) {
      pushToken(tokens, {
        line,
        startCharacter: start,
        length,
        type: 'collieEventHandler'
      });
    }

    // move forward
    i = j - 1;
  }
}
