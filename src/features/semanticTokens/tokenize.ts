import type { CollieSemanticTokenType } from './legend';

export interface CollieSemanticToken {
  line: number;
  startCharacter: number;
  length: number;
  type: CollieSemanticTokenType;
}

interface TokenizerState {
  inBlockComment: boolean;
  propsIndent: number | null;
  classesIndent: number | null;
}

interface Segment {
  start: number;
  end: number;
}

const directivePattern = /^@(if|elseIf|else)\b/g;
const forLoopPattern = /^@for\s+([A-Za-z_][\w]*)\s+in\s+([A-Za-z_][\w.[\]]*)/g;
const classShorthandPattern = /\.(?:\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][\w-]*)/g;
const singleBracePattern = /(?<!\{)\{(?!\{).*?(?<!\})\}(?!\})/g;
const interpolationPattern = /\{\{.*?\}\}/g;
const idDirectivePattern = /^(\s*)(#?id)(?:\s+|:\s*|=\s*)(.+)$/i;
const propsKeywordPattern = /^(\s*)(#?props)\b/;
const propsFieldPattern = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\??)\s*:/;
const tagPattern = /^(\s*)([A-Za-z][A-Za-z0-9_$-]*)/;
const pipeTextPattern = /^(\s*)\|/;
const classesKeywordPattern = /^(\s*)(#?classes)\b/;
const classAliasLinePattern = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const expressionLinePattern = /^(\s*)(=)\s+/;

export function tokenizeCollieSemanticTokens(text: string): CollieSemanticToken[] {
  const tokens: CollieSemanticToken[] = [];
  const state: TokenizerState = {
    inBlockComment: false,
    propsIndent: null,
    classesIndent: null
  };

  const lines = text.split(/\r?\n/);

  for (let line = 0; line < lines.length; line++) {
    const lineText = lines[line];
    const commentSegments = computeCommentSegments(lineText, state);

    for (const segment of commentSegments) {
      pushToken(tokens, {
        line,
        startCharacter: segment.start,
        length: segment.end - segment.start,
        type: 'collieComment'
      });
    }

    const nonWhitespace = lineText.trim();
    const indent = lineText.length - lineText.trimStart().length;

    if (state.propsIndent !== null) {
      if (nonWhitespace.length === 0) {
        // stay inside props block on blank lines
      } else if (indent <= state.propsIndent && !propsKeywordPattern.test(lineText)) {
        state.propsIndent = null;
      }
    }
    if (state.classesIndent !== null) {
      if (nonWhitespace.length === 0) {
        // stay inside classes block on blank lines
      } else if (indent <= state.classesIndent && !classesKeywordPattern.test(lineText)) {
        state.classesIndent = null;
      }
    }

    if (lineText.length === 0) {
      continue;
    }

    // Pipe text takes priority and consumes the rest of the line (outside comments)
    const pipeMatch = pipeTextPattern.exec(lineText);
    pipeTextPattern.lastIndex = 0;
    if (pipeMatch) {
      const start = pipeMatch[1].length;
      let length = lineText.length - start;
      length = clipTokenLength(commentSegments, start, length);
      if (length > 0 && !overlaps(commentSegments, start, length)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length,
          type: 'colliePipeText'
        });
        continue;
      }
    }

    // ID directive (case-insensitive)
    const idDirectiveMatch = idDirectivePattern.exec(lineText);
    idDirectivePattern.lastIndex = 0;
    if (idDirectiveMatch) {
      const indentLength = idDirectiveMatch[1].length;
      const keywordPart = idDirectiveMatch[2];
      const valuePart = idDirectiveMatch[3].trim();

      // Tokenize keyword (#id, id, ID, etc.)
      if (!overlaps(commentSegments, indentLength, keywordPart.length)) {
        pushToken(tokens, {
          line,
          startCharacter: indentLength,
          length: keywordPart.length,
          type: 'collieIdKeyword'
        });
      }

      // Find the start of the value (after keyword and separator)
      const fullMatch = idDirectiveMatch[0];
      const valueStartInMatch = fullMatch.indexOf(valuePart);
      if (valueStartInMatch !== -1) {
        const valueStart = valueStartInMatch;
        let valueLength = valuePart.length;
        valueLength = clipTokenLength(commentSegments, valueStart, valueLength);
        if (valueLength > 0 && !overlaps(commentSegments, valueStart, valueLength)) {
          const trimmedValue = lineText
            .slice(valueStart, valueStart + valueLength)
            .trimEnd();
          valueLength = trimmedValue.length;
        }
        if (valueLength > 0 && !overlaps(commentSegments, valueStart, valueLength)) {
          pushToken(tokens, {
            line,
            startCharacter: valueStart,
            length: valueLength,
            type: 'collieIdValue'
          });
        }
      }
    }

    const propsKeywordMatch = propsKeywordPattern.exec(lineText);
    propsKeywordPattern.lastIndex = 0;
    if (propsKeywordMatch) {
      const start = propsKeywordMatch[1].length;
      const keywordLength = propsKeywordMatch[2].length;
      if (!overlaps(commentSegments, start, keywordLength)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length: keywordLength,
          type: 'colliePropsKeyword'
        });
        state.propsIndent = start;
      }
    }

    const classesKeywordMatch = classesKeywordPattern.exec(lineText);
    classesKeywordPattern.lastIndex = 0;
    if (classesKeywordMatch) {
      const start = classesKeywordMatch[1].length;
      const keywordLength = classesKeywordMatch[2].length;
      if (!overlaps(commentSegments, start, keywordLength)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length: keywordLength,
          type: 'collieClassesKeyword'
        });
        state.classesIndent = start;
      }
    }

    const inPropsBlock = state.propsIndent !== null && indent > state.propsIndent;
    const inClassesBlock = state.classesIndent !== null && indent > state.classesIndent;

    if (inPropsBlock) {
      const propsFieldMatch = propsFieldPattern.exec(lineText);
      propsFieldPattern.lastIndex = 0;
      if (propsFieldMatch) {
        const start = propsFieldMatch[1].length;
        const fieldName = propsFieldMatch[2];
        if (!overlaps(commentSegments, start, fieldName.length)) {
          pushToken(tokens, {
            line,
            startCharacter: start,
            length: fieldName.length,
            type: 'colliePropsField'
          });
        }
      }
    }

    if (inClassesBlock) {
      const classAliasMatch = classAliasLinePattern.exec(lineText);
      classAliasLinePattern.lastIndex = 0;
      if (classAliasMatch) {
        const start = classAliasMatch[1].length;
        const alias = classAliasMatch[2];
        if (!overlaps(commentSegments, start, alias.length)) {
          pushToken(tokens, {
            line,
            startCharacter: start,
            length: alias.length,
            type: 'collieClassAliasName'
          });
        }
      }
    }

    // Expression lines (= expression)
    const expressionLineMatch = expressionLinePattern.exec(lineText);
    expressionLinePattern.lastIndex = 0;
    if (expressionLineMatch) {
      const start = expressionLineMatch[1].length;
      const equalsLength = expressionLineMatch[2].length;
      if (!overlaps(commentSegments, start, equalsLength)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length: equalsLength,
          type: 'collieExpressionLine'
        });
      }
    }

    const lineBody = lineText.slice(indent);

    // @for loops
    forLoopPattern.lastIndex = 0;
    let forMatch: RegExpExecArray | null;
    while ((forMatch = forLoopPattern.exec(lineBody))) {
      const start = indent + forMatch.index;
      const length = forMatch[0].length;
      if (!overlaps(commentSegments, start, length)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length,
          type: 'collieForLoop'
        });
      }
    }

    // Directives
    directivePattern.lastIndex = 0;
    let directiveMatch: RegExpExecArray | null;
    while ((directiveMatch = directivePattern.exec(lineBody))) {
      const start = indent + directiveMatch.index;
      const length = directiveMatch[0].length;
      if (!overlaps(commentSegments, start, length)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length,
          type: 'collieDirective'
        });
      }
    }

    // Tag names (avoid props block content)
    if (!inPropsBlock) {
      const tagMatch = tagPattern.exec(lineText);
      tagPattern.lastIndex = 0;
      if (tagMatch) {
        const start = tagMatch[1].length;
        const tagName = tagMatch[2];
        if (
          tagName !== 'props' &&
          tagName !== 'classes' &&
          !lineText.slice(start, start + tagName.length).startsWith('@') &&
          !overlaps(commentSegments, start, tagName.length)
        ) {
          // Distinguish between components (capitalized) and HTML tags (lowercase)
          const tokenType = /^[A-Z]/.test(tagName) ? 'collieComponent' : 'collieTag';
          pushToken(tokens, {
            line,
            startCharacter: start,
            length: tagName.length,
            type: tokenType
          });
        }
      }
    }

    if (!inPropsBlock && !inClassesBlock) {
      const tagMatch = tagPattern.exec(lineText);
      tagPattern.lastIndex = 0;

      if (tagMatch) {
        const tagStart = tagMatch[1].length;        // indentation length
        const tagName = tagMatch[2];
        const afterTag = tagStart + tagName.length;

        // Find where the tag head ends:
        // stop at first whitespace, '(' (attrs), or '|' (inline text marker)
        let headEnd = lineText.length;
        for (let i = afterTag; i < lineText.length; i++) {
          const ch = lineText[i];
          if (ch === '(' || ch === '|' || ch === ' ' || ch === '\t') {
            headEnd = i;
            break;
          }
        }

        // Scan only within [afterTag, headEnd)
        const head = lineText.slice(afterTag, headEnd);

        classShorthandPattern.lastIndex = 0;
        let classMatch: RegExpExecArray | null;

        while ((classMatch = classShorthandPattern.exec(head))) {
          const localStart = classMatch.index;
          const matchText = classMatch[0];

          const absoluteStart = afterTag + localStart;
          const length = matchText.length;

          if (!overlaps(commentSegments, absoluteStart, length)) {
            if (matchText[1] === '$') {
              // ".${alias}" style usage — we currently tokenize "$alias" without the dot
              pushToken(tokens, {
                line,
                startCharacter: absoluteStart + 1,
                length: length - 1,
                type: 'collieClassAliasUsage'
              });
            } else {
              pushToken(tokens, {
                line,
                startCharacter: absoluteStart,
                length,
                type: 'collieClassShorthand'
              });
            }
          }
        }
      }
    }

    // Event handler keys: onXxx= inside attribute lists
    if (!inPropsBlock && !inClassesBlock) {
      const openParen = lineText.indexOf('(');
      if (openParen !== -1 && !overlaps(commentSegments, openParen, 1)) {
        const closeParen = findMatchingParenOutsideStrings(lineText, openParen);
        if (closeParen !== -1) {
          // scan between parens (excluding them)
          tokenizeEventHandlerKeysInAttrList(
            tokens,
            line,
            lineText,
            openParen + 1,
            closeParen,
            commentSegments
          );
        }
      }
    }

    // Single-brace interpolation {expr}
    singleBracePattern.lastIndex = 0;
    let singleBraceMatch: RegExpExecArray | null;
    while ((singleBraceMatch = singleBracePattern.exec(lineText))) {
      const start = singleBraceMatch.index;
      const length = singleBraceMatch[0].length;
      if (!overlaps(commentSegments, start, length)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length,
          type: 'collieSingleBraceInterpolation'
        });
      }
    }

    // Interpolation segments (per line)
    interpolationPattern.lastIndex = 0;
    let interpolationMatch: RegExpExecArray | null;
    while ((interpolationMatch = interpolationPattern.exec(lineText))) {
      const start = interpolationMatch.index;
      const length = interpolationMatch[0].length;
      if (!overlaps(commentSegments, start, length)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length,
          type: 'collieInterpolation'
        });
      }
    }
  }

  tokens.sort((a, b) => {
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.startCharacter - b.startCharacter;
  });

  return tokens;
}

function computeCommentSegments(lineText: string, state: TokenizerState): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  while (cursor < lineText.length) {
    if (state.inBlockComment) {
      const endIdx = lineText.indexOf('*/', cursor);
      if (endIdx === -1) {
        segments.push({ start: cursor, end: lineText.length });
        cursor = lineText.length;
        break;
      } else {
        const segmentEnd = endIdx + 2;
        segments.push({ start: cursor, end: segmentEnd });
        cursor = segmentEnd;
        state.inBlockComment = false;
      }
    } else {
      const blockStart = lineText.indexOf('/*', cursor);
      const lineCommentIdx = findLineCommentOutsideStrings(lineText, cursor);

      if (lineCommentIdx !== -1 && (blockStart === -1 || lineCommentIdx < blockStart)) {
        break;
      }

      if (blockStart === -1) {
        break;
      }

      const blockEnd = lineText.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        segments.push({ start: blockStart, end: lineText.length });
        state.inBlockComment = true;
        cursor = lineText.length;
        break;
      } else {
        const segmentEnd = blockEnd + 2;
        segments.push({ start: blockStart, end: segmentEnd });
        cursor = segmentEnd;
      }
    }
  }

  // Line comment (//) outside block comments AND outside quoted strings.
  const lineCommentIdx = findLineCommentOutsideStrings(lineText);
  if (
    lineCommentIdx !== -1 &&
    !segments.some(segment => lineCommentIdx >= segment.start && lineCommentIdx < segment.end)
  ) {
    segments.push({ start: lineCommentIdx, end: lineText.length });
  }

  segments.sort((a, b) => a.start - b.start);
  return segments;
}

function findLineCommentOutsideStrings(lineText: string, startIndex = 0): number {
  let inSingle = false;
  let inDouble = false;

  for (let i = startIndex; i < lineText.length - 1; i++) {
    const ch = lineText[i];
    const next = lineText[i + 1];

    // handle quote state (ignore escaped quotes)
    if (!inDouble && ch === "'" && lineText[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && lineText[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    // only recognize // when not inside quotes
    if (!inSingle && !inDouble && ch === '/' && next === '/') {
      return i;
    }
  }

  return -1;
}

function findMatchingParenOutsideStrings(lineText: string, openIndex: number): number {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;

  for (let i = openIndex; i < lineText.length; i++) {
    const ch = lineText[i];

    // quote toggles (ignore escaped quotes)
    if (!inDouble && ch === "'" && lineText[i - 1] !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"' && lineText[i - 1] !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle || inDouble) continue;

    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function tokenizeEventHandlerKeysInAttrList(
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

function overlaps(segments: Segment[], start: number, length: number): boolean {
  if (length <= 0) {
    return true;
  }
  const end = start + length;
  return segments.some(segment => start < segment.end && end > segment.start);
}

function clipTokenLength(segments: Segment[], start: number, length: number): number {
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

function pushToken(tokens: CollieSemanticToken[], token: CollieSemanticToken) {
  if (token.length <= 0) {
    return;
  }
  tokens.push(token);
}
