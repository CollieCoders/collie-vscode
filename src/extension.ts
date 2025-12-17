import type { ExtensionContext } from 'vscode';

export async function activate(context: ExtensionContext) {
  console.log('Collie extension activating');

  context.subscriptions.push({
    dispose() {
      console.log('Collie extension disposed');
    }
  });
}

export function deactivate() {
  console.log('Collie extension deactivated');
}
