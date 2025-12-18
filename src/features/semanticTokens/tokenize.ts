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
}

interface Segment {
  start: number;
  end: number;
}

const directivePattern = /@(if|elseIf|else)\b/g;
const classShorthandPattern = /\.[A-Za-z_][\w-]*/g;
const interpolationPattern = /\{\{.*?\}\}/g;
const propsKeywordPattern = /^(\s*)(props)\b/;
const propsFieldPattern = /^(\s*)([A-Za-z_][\w-]*)(\??)\s*:/;
const tagPattern = /^(\s*)([A-Za-z][\w-]*)/;
const pipeTextPattern = /^(\s*)\|/;

export function tokenizeCollieSemanticTokens(text: string): CollieSemanticToken[] {
  const tokens: CollieSemanticToken[] = [];
  const state: TokenizerState = {
    inBlockComment: false,
    propsIndent: null
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

    const inPropsBlock = state.propsIndent !== null && indent > state.propsIndent;

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
          !lineText.slice(start, start + tagName.length).startsWith('@') &&
          !overlaps(commentSegments, start, tagName.length)
        ) {
          pushToken(tokens, {
            line,
            startCharacter: start,
            length: tagName.length,
            type: 'collieTag'
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
        pushToken(tokens, {
          line,
          startCharacter: start,
          length,
          type: 'collieClassShorthand'
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
