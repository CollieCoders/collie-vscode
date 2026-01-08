import type { CollieSemanticTokenType } from '../legend';

export interface CollieSemanticToken {
  line: number;
  startCharacter: number;
  length: number;
  type: CollieSemanticTokenType;
}

export interface TokenizerState {
  inBlockComment: boolean;
  inputsIndent: number | null;
  classesIndent: number | null;
}

export interface Segment {
  start: number;
  end: number;
}
