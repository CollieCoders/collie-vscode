import { ConfigurationTarget, workspace } from 'vscode';

export interface TokenCustomizationRule {
  foreground?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface SemanticTokenCustomizationConfig {
  enabled?: boolean;
  rules?: Record<string, TokenCustomizationRule>;
}

function normalizeCustomizations(value: unknown): SemanticTokenCustomizationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const { enabled, rules } = value as SemanticTokenCustomizationConfig;
  const normalized: SemanticTokenCustomizationConfig = {};

  if (typeof enabled === 'boolean') {
    normalized.enabled = enabled;
  }

  if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
    normalized.rules = { ...rules };
  }

  return normalized;
}

function createRulesMap(existing: Record<string, TokenCustomizationRule> | undefined) {
  return existing ? { ...existing } : {};
}

function hasRules(rules: Record<string, TokenCustomizationRule> | undefined): rules is Record<string, TokenCustomizationRule> {
  return !!rules && Object.keys(rules).length > 0;
}

const EDITOR_CONFIG_KEY = 'semanticTokenColorCustomizations';

export async function applyTokenCustomizationRule(
  tokenType: string,
  customization: TokenCustomizationRule,
  target: ConfigurationTarget
) {
  const editorConfig = workspace.getConfiguration('editor');
  const current = normalizeCustomizations(editorConfig.get(EDITOR_CONFIG_KEY));
  const next: SemanticTokenCustomizationConfig = { ...current };
  const rules = createRulesMap(current.rules);

  rules[tokenType] = customization;
  next.rules = rules;
  next.enabled = true;

  await editorConfig.update(EDITOR_CONFIG_KEY, next, target);
}

export async function removeTokenCustomizationRule(tokenType: string, target: ConfigurationTarget) {
  const editorConfig = workspace.getConfiguration('editor');
  const current = normalizeCustomizations(editorConfig.get(EDITOR_CONFIG_KEY));
  const next: SemanticTokenCustomizationConfig = { ...current };
  const rules = createRulesMap(current.rules);

  delete rules[tokenType];

  if (hasRules(rules)) {
    next.rules = rules;
  } else {
    await editorConfig.update(EDITOR_CONFIG_KEY, undefined, target);
    return;
  }

  if (!next.enabled && !next.rules) {
    await editorConfig.update(EDITOR_CONFIG_KEY, undefined, target);
    return;
  }

  await editorConfig.update(EDITOR_CONFIG_KEY, next, target);
}
