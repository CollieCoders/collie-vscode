# Collie VS Code Extension

Unofficial VS Code integration for the Collie templating language. This repository currently tracks the MVP milestones outlined in `mvp-implementation-plan.md`.

## Development Scripts

- `pnpm build` – bundle the extension with esbuild
- `pnpm watch` – rebuild on file change
- `pnpm package` – create a `.vsix` via `vsce`
- `pnpm lint` – run TypeScript for type checking only

## Installation via VSIX

1. Run `pnpm install` followed by `pnpm package` to produce `collie-vscode-<version>.vsix` in the repo root.
2. In VS Code, open the Extensions view, choose “Install from VSIX…”, and select the generated `.vsix`.
3. Reload the window; `.collie` files should now highlight with the Collie grammar.

## Extension Development Host

1. Run `pnpm watch` (optional) to keep the bundle up to date while editing.
2. Press `F5` in VS Code to launch the Extension Development Host using the provided `.vscode/launch.json`.
3. Open a `.collie` file in the Dev Host to verify syntax highlighting and editor behaviors live.

## Semantic Tokens & Settings

- Collie semantic tokens light up `.collie` files with type-aware colors. They are enabled by default and can be toggled via the `Collie: Semantic Tokens Enabled` (`collie.semanticTokens.enabled`) setting if you need to fall back to TextMate scopes temporarily.
- Verbose extension logging can be enabled with `Collie: Logging Enabled` (`collie.logging.enabled`) for debugging activation issues.

## Roadmap

- **Formatting (planned):** `src/features/formatting/formatProvider.ts` contains the stub that future formatters will extend.
- **Diagnostics (planned):** placeholder architecture ensures we can add syntax/semantic checks without restructuring the extension.
- **Language Server integration (possible):** project layout leaves room for an eventual LSP-based workflow once Collie tooling matures.
