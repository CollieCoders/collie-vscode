import type { Diagnostic, DiagnosticCode, SourceSpan } from '../diagnostics';
import { createSpan } from '../diagnostics';

export function pushDiag(
  diagnostics: Diagnostic[],
  code: DiagnosticCode,
  message: string,
  line: number,
  column: number,
  lineOffset: number,
  length = 1
): void {
  diagnostics.push({
    severity: 'error',
    code,
    message,
    span: createSpan(line, column, Math.max(length, 1), lineOffset)
  });
}
