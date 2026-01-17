import type { CollieSemanticToken, TokenizerState } from './types';
import {
  classAliasLinePattern,
  classesKeywordPattern,
  classShorthandPattern,
  directivePattern,
  expressionLinePattern,
  forLoopPattern,
  idDirectivePattern,
  interpolationPattern,
  pipeTextPattern,
  inputsFieldPattern,
  inputsKeywordPattern,
  singleBracePattern,
  tagPattern
} from './helpers/patterns';
import { computeCommentSegments, findMatchingParenOutsideStrings } from './helpers/comments';
import { clipTokenLength, overlaps, pushToken, tokenizeEventHandlerKeysInAttrList } from './helpers/tokens';

export type { CollieSemanticToken } from './types';

export function tokenizeCollieSemanticTokens(text: string): CollieSemanticToken[] {
  const tokens: CollieSemanticToken[] = [];
  const state: TokenizerState = {
    inBlockComment: false,
    inputsIndent: null,
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

    if (state.inputsIndent !== null) {
      if (nonWhitespace.length === 0) {
        // stay inside inputs block on blank lines
      } else if (indent <= state.inputsIndent && !inputsKeywordPattern.test(lineText)) {
        state.inputsIndent = null;
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

    const inputsKeywordMatch = inputsKeywordPattern.exec(lineText);
    inputsKeywordPattern.lastIndex = 0;
    if (inputsKeywordMatch) {
      const start = inputsKeywordMatch[1].length;
      const keywordLength = inputsKeywordMatch[2].length;
      if (!overlaps(commentSegments, start, keywordLength)) {
        pushToken(tokens, {
          line,
          startCharacter: start,
          length: keywordLength,
          type: 'collieInputsKeyword'
        });
        state.inputsIndent = start;
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

    const inInputsBlock = state.inputsIndent !== null && indent > state.inputsIndent;
    const inClassesBlock = state.classesIndent !== null && indent > state.classesIndent;

    if (inInputsBlock) {
      const inputsFieldMatch = inputsFieldPattern.exec(lineText);
      inputsFieldPattern.lastIndex = 0;
      if (inputsFieldMatch) {
        const start = inputsFieldMatch[1].length;
        const fieldName = inputsFieldMatch[2];
        const suffix = inputsFieldMatch[3];
        const isFnProp = suffix === '()';
        
        if (!overlaps(commentSegments, start, fieldName.length)) {
          pushToken(tokens, {
            line,
            startCharacter: start,
            length: fieldName.length,
            type: isFnProp ? 'collieInputsFieldFn' : 'collieInputsField'
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

    // Tag names (avoid inputs block content)
    if (!inInputsBlock) {
      const tagMatch = tagPattern.exec(lineText);
      tagPattern.lastIndex = 0;
      if (tagMatch) {
        const start = tagMatch[1].length;
        const tagName = tagMatch[2];
        if (
          tagName !== 'inputs' &&
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

    if (!inInputsBlock && !inClassesBlock) {
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
    if (!inInputsBlock && !inClassesBlock) {
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
