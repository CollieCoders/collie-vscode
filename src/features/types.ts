import type { Disposable, ExtensionContext } from 'vscode';
import type { Logger } from '../logger';

export interface FeatureContext {
  readonly extensionContext: ExtensionContext;
  readonly logger: Logger;
  register<T extends Disposable>(disposable: T): T;
}

export type FeatureRegistration = (context: FeatureContext) => void | Promise<void>;
