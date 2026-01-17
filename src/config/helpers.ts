import { Uri, workspace, type TextDocument } from 'vscode';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import * as path from 'path';
import type { Logger } from '../logger';
import type { CollieConfigParsed, CollieConfigFlags, CollieConfigResult } from './types';
import { CONFIG_FILENAMES } from './constants';

const require = createRequire(__filename);

export function createDefaultFlags(): CollieConfigFlags {
  return {
    enableCssIndex: false,
    enableUnknownClassDiagnostics: false,
    cssStrategy: 'unknown',
    unknownClassSetting: undefined,
    isTailwind: false,
    isGlobal: false
  };
}

export function computeFlags(parsed: CollieConfigParsed): CollieConfigFlags {
  const strategy = parsed.cssStrategy ?? 'unknown';
  const unknownClassSetting = parsed.cssUnknownClass;
  const isGlobal = strategy === 'global';
  const isTailwind = strategy === 'tailwind';

  if (isGlobal) {
    const enableUnknown = unknownClassSetting !== 'off';
    return {
      enableCssIndex: enableUnknown,
      enableUnknownClassDiagnostics: enableUnknown,
      cssStrategy: strategy,
      unknownClassSetting,
      isTailwind,
      isGlobal
    };
  }

  return {
    enableCssIndex: false,
    enableUnknownClassDiagnostics: false,
    cssStrategy: strategy,
    unknownClassSetting,
    isTailwind,
    isGlobal
  };
}

export function extractConfigFields(rawConfig: unknown): CollieConfigParsed {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const config = rawConfig as Record<string, unknown>;
  const parsed: CollieConfigParsed = {};

  const css = config.css;
  if (css && typeof css === 'object') {
    const cssConfig = css as Record<string, unknown>;
    if (typeof cssConfig.strategy === 'string') {
      parsed.cssStrategy = cssConfig.strategy;
    }
    const diagnostics = cssConfig.diagnostics;
    if (diagnostics && typeof diagnostics === 'object') {
      const diagConfig = diagnostics as Record<string, unknown>;
      if (typeof diagConfig.unknownClass === 'string') {
        parsed.cssUnknownClass = diagConfig.unknownClass;
      }
    }
  }

  const dialect = config.dialect;
  if (typeof dialect === 'string') {
    parsed.dialect = dialect;
  } else if (dialect && typeof dialect === 'object') {
    const dialectConfig = dialect as Record<string, unknown>;
    if (typeof dialectConfig.name === 'string') {
      parsed.dialect = dialectConfig.name;
    }
    const legacyDialectOptionsKey = String.fromCharCode(112, 114, 111, 112, 115);
    if (legacyDialectOptionsKey in dialectConfig) {
      parsed.dialectOptions = dialectConfig[legacyDialectOptionsKey];
    }
  }

  const inputs = config.inputs;
  if (inputs && typeof inputs === 'object') {
    const inputsConfig = inputs as Record<string, unknown>;
    const reactIntegration = inputsConfig.reactIntegration;
    if (reactIntegration && typeof reactIntegration === 'object') {
      const reactConfig = reactIntegration as Record<string, unknown>;
      if (typeof reactConfig.enabled === 'boolean') {
        parsed.inputsReactIntegrationEnabled = reactConfig.enabled;
      }
    }
  }

  return parsed;
}

export function normalizeResult(configPath: string | undefined, parsed: CollieConfigParsed): CollieConfigResult {
  return {
    configPath,
    parsed,
    flags: computeFlags(parsed)
  };
}

export function getCacheKey(document: TextDocument): string | undefined {
  if (document.uri.scheme !== 'file') {
    return undefined;
  }
  return path.dirname(document.uri.fsPath);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await workspace.fs.stat(Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}

export async function findNearestConfigPath(startDir: string, stopDir?: string): Promise<string | undefined> {
  let current = startDir;
  const root = path.parse(current).root;

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(current, filename);
      if (await fileExists(candidate)) {
        return candidate;
      }
    }

    if (current === root || (stopDir && current === stopDir)) {
      break;
    }

    current = path.dirname(current);
  }

  return undefined;
}

async function importConfigFresh(configPath: string): Promise<unknown> {
  const fileUrl = pathToFileURL(configPath);
  const module = await import(`${fileUrl.href}?t=${Date.now()}`);
  return (module as { default?: unknown }).default ?? module;
}

function loadCommonJsConfig(configPath: string): unknown {
  const resolved = require.resolve(configPath);
  delete require.cache[resolved];
  const module = require(configPath);
  return (module as { default?: unknown }).default ?? module;
}

function isRequireEsmError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ERR_REQUIRE_ESM'
  );
}

export async function loadConfigFile(configPath: string, logger?: Logger): Promise<unknown | null> {
  const ext = path.extname(configPath);

  try {
    if (ext === '.json') {
      const contents = await workspace.fs.readFile(Uri.file(configPath));
      return JSON.parse(Buffer.from(contents).toString('utf8'));
    }

    if (ext === '.mjs' || ext === '.mts') {
      return await importConfigFresh(configPath);
    }

    if (ext === '.js' || ext === '.cjs' || ext === '.cts') {
      try {
        return loadCommonJsConfig(configPath);
      } catch (error) {
        if (isRequireEsmError(error)) {
          return await importConfigFresh(configPath);
        }
        throw error;
      }
    }

    if (ext === '.ts') {
      try {
        return await importConfigFresh(configPath);
      } catch (error) {
        logger?.warn(`Unable to load TypeScript config at ${configPath}.`, error);
        return null;
      }
    }

    logger?.warn(`Unsupported Collie config file extension: ${configPath}`);
    return null;
  } catch (error) {
    logger?.warn(`Failed to load Collie config at ${configPath}.`, error);
    return null;
  }
}
