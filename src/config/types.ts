export interface CollieConfigParsed {
  cssStrategy?: string;
  cssUnknownClass?: string;
  dialect?: string;
  dialectProps?: unknown;
  inputsReactIntegrationEnabled?: boolean;
}

export interface CollieConfigFlags {
  enableCssIndex: boolean;
  enableUnknownClassDiagnostics: boolean;
  cssStrategy: string;
  unknownClassSetting?: string;
  isTailwind: boolean;
  isGlobal: boolean;
}

export interface CollieConfigResult {
  configPath?: string;
  parsed: CollieConfigParsed;
  flags: CollieConfigFlags;
}

export interface CollieConfigChange {
  configPath?: string;
  workspaceFolder?: string;
}
