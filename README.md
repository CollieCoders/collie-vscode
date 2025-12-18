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

## Convert JSX/TSX to Collie (Priority 4A)

Use the **Collie: Convert JSX/TSX Selection to Collie** command to bootstrap new `.collie` files from existing React components:

1. Highlight the JSX/TSX you want to convert inside a `*.tsx` or `*.jsx` editor (multi-node selections are allowed).
2. Run the command from the Command Palette. The extension parses the selection, logs the TypeScript AST + intermediate representation, and prints best-effort Collie output to the **Collie Conversion** output channel.
3. Choose **Create File** to save a new `.collie` file next to the source component (you can rename or relocate it in the save dialog), or pick **Copy to Clipboard** to paste the text elsewhere. The clipboard path also opens an untitled preview so you can inspect the result immediately.

The conversion intentionally favors progress over perfection:

- Unsupported constructs are never dropped—expression placeholders such as `{{ /* Collie TODO: ... */ }}` are emitted instead, and matching warnings appear in the output channel so you know what to clean up manually.
- The original TSX file is not modified; the command only reads the current selection.
- Because the converter wraps fragments in a synthetic component during parsing, whitespace-only selections are rejected up front with a friendly message.

This workflow lets you incrementally migrate components: select a render subtree, run the command, review the logged IR/collie output for accuracy, and then paste or save the generated `.collie` file when you are satisfied.

## Copy Collie to JSX/TSX (Priority 4B)

Need to bail out temporarily? The escape hatch mirrors the conversion flow in reverse and keeps things non-destructive:

1. Open the Collie file you want to share with a teammate who prefers JSX/TSX.
2. Run **Collie: Copy as JSX** or **Collie: Copy as TSX** from the Command Palette.
3. The extension parses the file, logs the AST/IR/diagnostics to the **Collie Export** output channel, copies the generated snippet to your clipboard, and opens an untitled preview for quick inspection.

Key guardrails:

- **Nothing is overwritten.** The `.collie` file stays untouched; output goes to the clipboard and preview only.
- **Readable output.** JSX exports preserve your structure, class shorthands become `className="..."`, and Collie conditionals convert into logical/ternary expressions. TSX exports wrap the snippet in a conservative `export function NameExport(): JSX.Element` so strict projects can paste it directly.
- **Transparent fallbacks.** If the parser encounters something it can't represent, a JSX comment such as `/* Collie TODO: props block present... */` appears in the snippet and matching notes are highlighted in the output channel. The command never fails silently.

This gives teams confidence that they can round-trip between Collie and JSX while the Collie-specific tooling matures.

## Experimental Language Features (Priority 3)

Priority 3 introduces best-effort editing ergonomics layered on top of the existing syntax/formatting support. These features are intentionally gated behind settings so you can opt in as they stabilize:

- **Diagnostics (`collie.features.diagnostics`)** – surfaces indentation errors, unknown directives, duplicate props, and malformed selectors in the Problems panel. Updates are throttled and never block typing.
- **Outline & Go To Definition (`collie.features.navigation`)** – adds a document outline for props, top-level elements, and conditional branches, plus Cmd/Ctrl+Click navigation from component usages to same-folder or sibling-folder `.collie`/`.tsx` files.
- **Hover Info (`collie.features.hover`)** – lightweight tooltips for directives (`@if`, `@elseIf`, `@else`), props fields, and inline `{{ }}` expressions.
- **Completions (`collie.features.completions`)** – quick suggestions for directives, common HTML tags, and local component names discovered in the current file or sibling files. Component lists refresh automatically when files are added/removed.

Enable any subset via Settings > Collie or directly in `.vscode/settings.json`:

```jsonc
"collie.features": {
  "diagnostics": true,
  "navigation": true,
  "hover": true,
  "completions": true
}
```

All features run off the shared parser/AST cache introduced in Priority 2, so enabling multiple providers does not re-parse the document redundantly.

## Roadmap

- **Formatter enhancements:** add selection/range formatting and smarter fallbacks once the core formatter proves stable.
- **Language Server integration (exploratory):** the current architecture leaves room for an eventual LSP-based workflow once Collie tooling matures further.
