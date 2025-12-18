export type DiagnosticSeverity = 'error' | 'warning';

export type DiagnosticCode =
  | 'COLLIE001'
  | 'COLLIE002'
  | 'COLLIE003'
  | 'COLLIE004'
  | 'COLLIE005'
  | 'COLLIE101'
  | 'COLLIE102'
  | 'COLLIE201'
  | 'COLLIE202'
  | 'COLLIE203'
  | 'COLLIE204'
  | 'COLLIE205'
  | 'COLLIE206'
  | 'COLLIE207'
  | 'COLLIE208'
  | 'COLLIE209';

export interface SourcePos {
  line: number;
  col: number;
  offset: number;
}

export interface SourceSpan {
  start: SourcePos;
  end: SourcePos;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  span?: SourceSpan;
  code?: DiagnosticCode;
  file?: string;
}

export function createSpan(line: number, col: number, length: number, lineOffset: number): SourceSpan {
  const startOffset = lineOffset + col - 1;
  return {
    start: { line, col, offset: startOffset },
    end: { line, col: col + length, offset: startOffset + length }
  };
}
