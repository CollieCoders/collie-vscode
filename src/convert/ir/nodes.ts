export type IrNode = IrElement | IrText | IrExpression | IrFragment;

export interface IrElement {
  readonly kind: 'element';
  readonly tagName: string;
  readonly classes: readonly string[];
  readonly props: readonly IrProp[];
  readonly children: readonly IrNode[];
}

export interface IrProp {
  readonly kind: 'prop';
  readonly name: string;
  /**
   * Omit value to represent boolean props or shorthand presence.
   * When present, keep the original textual form (quoted string, {expr}, etc.).
   */
  readonly value?: string;
}

export interface IrText {
  readonly kind: 'text';
  readonly value: string;
}

export interface IrExpression {
  readonly kind: 'expression';
  readonly expressionText: string;
}

export interface IrFragment {
  readonly kind: 'fragment';
  readonly children: readonly IrNode[];
}

export function createIrElement(
  tagName: string,
  options: {
    classes?: Iterable<string>;
    props?: Iterable<IrProp>;
    children?: Iterable<IrNode>;
  } = {}
): IrElement {
  const classes = normalizeClasses(options.classes);
  return {
    kind: 'element',
    tagName,
    classes,
    props: Array.from(options.props ?? []),
    children: Array.from(options.children ?? [])
  };
}

export function createIrProp(name: string, value?: string): IrProp {
  return {
    kind: 'prop',
    name,
    value
  };
}

export function createIrText(value: string): IrText {
  return {
    kind: 'text',
    value
  };
}

export function createIrExpression(expressionText: string): IrExpression {
  return {
    kind: 'expression',
    expressionText
  };
}

export function createIrFragment(children: Iterable<IrNode>): IrFragment {
  return {
    kind: 'fragment',
    children: Array.from(children)
  };
}

function normalizeClasses(classes?: Iterable<string>): readonly string[] {
  if (!classes) {
    return [];
  }
  const result: string[] = [];
  for (const candidate of classes) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      continue;
    }
    result.push(trimmed);
  }
  return result;
}
