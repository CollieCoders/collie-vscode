import type { TextNode } from '../parser';

export interface PipeFormatOptions {
  spaceAroundPipe: boolean;
}

export function buildTextPayload(node: TextNode): string {
  return node.parts
    .map(part => {
      if (part.type === 'text') {
        return part.value;
      }
      return `{{ ${part.value} }}`;
    })
    .join('');
}

export function formatInlinePipe(node: TextNode, options: PipeFormatOptions): string {
  const payload = buildTextPayload(node);
  if (!payload) {
    return options.spaceAroundPipe ? '| ' : '|';
  }
  return options.spaceAroundPipe ? `| ${payload}` : `|${payload}`;
}

export function formatBlockPipe(node: TextNode, options: PipeFormatOptions): string {
  return formatInlinePipe(node, options);
}
