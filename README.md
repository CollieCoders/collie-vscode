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
- Use the Command Palette (`Collie: Customize Token Color`) or the editor context menu inside `.collie` files to pick a token category, choose a color/style, and have the extension write the appropriate `editor.semanticTokenColorCustomizations.rules[...]` entry to either workspace or user settings. The `Collie: Reset Token Customization` command removes a rule when you want to revert back to theme defaults.
- Run the customization commands with your cursor on a tag, directive, props field, or class shorthand to have the extension pre-select that token type automatically; you can still override the choice in the picker if needed.
- Share your favorite highlighting scheme by running `Collie: Copy Token Customization Snippet`, which copies only the Collie-related semantic token rules to the clipboard so you can paste them into a README or `.vscode/settings.json`.

### Collie token types

- `collieTag` – opening tag identifiers (e.g., `MyComponent`)
- `collieClassShorthand` – `.class` shorthand segments in tag heads
- `collieDirective` – directive keywords such as `@if`, `@elseIf`, `@else`
- `colliePropsKeyword` – the `props` block header keyword
- `colliePropsField` – field identifiers declared within `props` blocks
- `collieInterpolation` – `{{ ... }}` interpolation expressions
- `colliePipeText` – pipe text lines that begin with `|`
- `collieComment` – block (`/* */`) and line (`//`) comments

### Example customization snippet

```jsonc
"editor.semanticTokenColorCustomizations": {
  "enabled": true,
  "rules": {
    "collieTag": { "foreground": "#C586C0", "bold": true },
    "collieDirective": { "foreground": "#DCDCAA", "italic": true },
    "colliePropsField": { "foreground": "#4EC9B0" }
  }
}
```

Paste the snippet into your workspace `.vscode/settings.json` or global settings file, or share it with the copied snippet command so teammates can reuse your palette.

## Formatting & Format on Save

- Collie ships a document formatter that parses the template into an AST and prints it back out with normalized indentation, selector spacing, pipe text alignment, props blocks, and conditional chains.
- Run **Format Document** (⇧⌥F / ⇧⌘I) inside a `.collie` file to invoke the formatter. If the file is too malformed to parse, the extension falls back to a conservative whitespace cleanup so format-on-save never leaves the editor untouched.
- Formatter options live under the `Collie` settings namespace:
  - `Collie: Format > Indent Size` (`collie.format.indentSize`, default `2`)
  - `Collie: Format > Prefer Compact Selectors` (`collie.format.preferCompactSelectors`, default `true`)
  - `Collie: Format > Space Around Pipe` (`collie.format.spaceAroundPipe`, default `true`)
  - `Collie: Format > Normalize Props Spacing` (`collie.format.normalizePropsSpacing`, default `true`)

### Recommended settings snippet

Add the following to your workspace `.vscode/settings.json` to use the Collie formatter by default and run it automatically on save:

```jsonc
"[collie]": {
  "editor.defaultFormatter": "collie.collie-vscode",
  "editor.formatOnSave": true
}
```

_(Range formatting is not yet implemented; use document formatting for now.)_

## Roadmap

- **Formatter enhancements (future):** add selection/range formatting and smarter fallbacks once the core formatter proves stable.
- **Diagnostics (planned):** placeholder architecture ensures we can add syntax/semantic checks without restructuring the extension.
- **Language Server integration (possible):** project layout leaves room for an eventual LSP-based workflow once Collie tooling matures.
