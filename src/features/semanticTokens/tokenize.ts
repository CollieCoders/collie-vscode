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

const directivePattern = /@(if|elseIf|else)\b/g;
const forLoopPattern = /@for\s+([A-Za-z_][\w]*)\s+in\s+([A-Za-z_][\w.[\]]*)/g;
const classShorthandPattern = /\.(?:\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][\w-]*)/g;
const singleBracePattern = /(?<!\{)\{(?!\{).*?(?<!\})\}(?!\})/g;
const interpolationPattern = /\{\{.*?\}\}/g;
const idDirectivePattern = /^(\s*)(#?id)(?:\s+|:\s*|=\s*)(.+)$/i;
const propsKeywordPattern = /^(\s*)(props)\b/;
const propsFieldPattern = /^(\s*)([A-Za-z_][\w-]*)(\??)\s*:/;
const tagPattern = /^(\s*)([A-Za-z][\w-]*)/;
const pipeTextPattern = /^(\s*)\|/;
const classesKeywordPattern = /^(\s*)(classes)\b/;
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
      const length = lineText.length - start;
      if (!overlaps(commentSegments, start, length)) {
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
        if (!overlaps(commentSegments, valueStart, valuePart.length)) {
          pushToken(tokens, {
            line,
            startCharacter: valueStart,
            length: valuePart.length,
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

    // @for loops
    forLoopPattern.lastIndex = 0;
    let forMatch: RegExpExecArray | null;
    while ((forMatch = forLoopPattern.exec(lineText))) {
      const start = forMatch.index;
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
    while ((directiveMatch = directivePattern.exec(lineText))) {
      const start = directiveMatch.index;
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

    // Class shorthand occurrences
    classShorthandPattern.lastIndex = 0;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classShorthandPattern.exec(lineText))) {
      const start = classMatch.index;
      const length = classMatch[0].length;
      if (!overlaps(commentSegments, start, length)) {
        if (classMatch[0][1] === '$') {
          pushToken(tokens, {
            line,
            startCharacter: start + 1,
            length: length - 1,
            type: 'collieClassAliasUsage'
          });
        } else {
          pushToken(tokens, {
            line,
            startCharacter: start,
            length,
            type: 'collieClassShorthand'
          });
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
      const lineCommentIdx = lineText.indexOf('//', cursor);

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

  // Line comment (//) outside block comments.
  const lineCommentIdx = lineText.indexOf('//');
  if (lineCommentIdx !== -1 && !segments.some(segment => lineCommentIdx >= segment.start && lineCommentIdx < segment.end)) {
    segments.push({ start: lineCommentIdx, end: lineText.length });
  }

  segments.sort((a, b) => a.start - b.start);
  return segments;
}

function overlaps(segments: Segment[], start: number, length: number): boolean {
  if (length <= 0) {
    return true;
  }
  const end = start + length;
  return segments.some(segment => start < segment.end && end > segment.start);
}

function pushToken(tokens: CollieSemanticToken[], token: CollieSemanticToken) {
  if (token.length <= 0) {
    return;
  }
  tokens.push(token);
}
