export interface FallbackFormatOptions {
  indentSize?: number;
}

const DEFAULT_FALLBACK_OPTIONS: Required<FallbackFormatOptions> = {
  indentSize: 2
};

export function fallbackFormat(text: string, options: FallbackFormatOptions = {}): string {
  const indentSize = Math.max(1, options.indentSize ?? DEFAULT_FALLBACK_OPTIONS.indentSize);
  const normalizedNewlines = text.replace(/\r\n?/g, '\n');
  const lines = normalizedNewlines.split('\n');
  const indentUnit = ' '.repeat(indentSize);

  const normalizedLines = lines.map(line => {
    if (!line) {
      return '';
    }

    const expanded = line.replace(/\t/g, indentUnit);
    const trimmedTrailing = expanded.replace(/\s+$/g, '');
    if (!trimmedTrailing) {
      return '';
    }

    const leadingMatch = trimmedTrailing.match(/^ +/);
    if (!leadingMatch) {
      return trimmedTrailing;
    }

    const currentIndent = leadingMatch[0].length;
    const normalizedIndent = Math.floor(currentIndent / indentSize) * indentSize;

    if (normalizedIndent === currentIndent) {
      return trimmedTrailing;
    }

    return ' '.repeat(normalizedIndent) + trimmedTrailing.slice(currentIndent);
  });

  return normalizedLines.join('\n');
}
