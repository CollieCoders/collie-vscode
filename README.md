# Collie - VS Code Support for Collie Templates

VS Code language support for Collie, an indentation-based template language for React-style components.

> Collie lets you write clean, indentation-based templates that map cleanly back to JSX/TSX.

---

## Features

Collie for VS Code is a single, lightweight extension that provides:

- **Language basics**
  - `.collie` file association and syntax highlighting
  - Collie-specific comments, indentation, and bracket behavior
  - Custom file icon for `.collie` templates in the Explorer

- **Semantic highlighting**
  - Token-aware colors for:
    - Tags and components
    - Class shorthands and `$aliases`
    - `#id`, `#inputs`, and `classes` blocks
    - Input fields (`name`, `name()`, and legacy `name: type`)
    - Directives (`@if`, `@elseIf`, `@else`, `@for`)
    - Interpolations (`{{ }}` and `{ }`)
    - Expression lines (`= expr` and `{{ expr }}` standalone)
    - Event handler attribute keys (`onClick`, `onSubmit`, ...)
    - Pipe text (`| some text`)
    - Comments
  - Ships with Collie defaults and works with your theme's semantic tokens

- **Formatting**
  - Document formatter that understands the Collie AST
  - Configurable:
    - Indentation width
    - Compact vs spaced selectors
    - Spacing around the pipe (`|`)
    - Normalized inputs spacing
  - Safe fallback formatter for malformed files (normalizes indentation only)

- **Editor tooling (on by default)**
  - **Diagnostics** in the Problems panel (parser errors, template ID collisions, unused templates, unknown directives, missing inputs, and more)
  - **Document outline** for templates, inputs, elements, conditionals, and loops
  - **Workspace symbols** for `#id` templates (Cmd/Ctrl+T)
  - **Go to Definition** for components, `#id` to HTML placeholders, `<Collie id="...">`, and HTML placeholders back to templates
  - **CSS class navigation** and unknown class diagnostics when a CSS index is enabled
  - **Hover** help for directives, inputs, class aliases, and expressions
  - **Completions** for directives, tags/components, class aliases, template IDs in TSX, and HTML placeholders

- **JSX/TSX interop**
  - Convert a JSX/TSX selection into a `#id` block and insert `<Collie id="...">` usage
  - Auto-generate a `#inputs` block and `<Collie inputs={{ ... }}>` from the selection
  - Copy a `.collie` file as JSX or TSX to paste into React code
  - Detailed logs in **Collie Conversion** and **Collie Export** output channels

---

## What Is Collie?

Collie is an indentation-based template language designed to play nicely with React and TSX:

```collie
#id ProfileCard

#inputs
  user
  isEditing
  onSave()

classes
  primaryButton = bg-sky-600.text-white.px-4.py-2.rounded

div.profile-card
  h2 {user.name}
  p.subtitle
    | {user.title}

  @if (isEditing)
    button.$primaryButton(onClick={onSave})
      | Save changes
  @else
    button.$primaryButton
      | Edit profile
```

Core ideas:

- **Indentation instead of closing tags** - cleaner, more readable markup.
- **Inputs are explicit** - declare `#inputs` at the top and use `name()` for function inputs.
- **Class aliases** - define bundles in `classes` and reference them as `.$alias`.
- **Strong mapping back to JSX/TSX** - easy conversion in both directions.

Notes:

- `#inputs` also supports legacy typed declarations like `count: number` or `onSave?: fn`.
- `classes` values are dot-separated class tokens (`primary = bg.blue.text-white`).

## Template IDs and runtime usage

`#id <id>` declares a template block. A single `.collie` file can define multiple templates by repeating `#id`.

```collie
#id Blog.navbar
nav.navbar
  | Navigation

#id Blog.footer
footer.footer
  | Footer
```

```tsx
import { Collie } from '@collie-lang/react';

<Collie id="Blog.navbar" />
```

The extension also understands HTML placeholders that end with `-collie`:

```html
<div id="Blog.navbar-collie"></div>
```

These conventions power HTML and TSX completions, go-to-definition, and the **Open Compiled HTML Partial**
command, which expects `collie/dist/<id>.html` under the workspace root.

---

## Installation

### From the VS Code Marketplace

1. Open the **Extensions** view in VS Code.
2. Search for **"Collie"** (publisher: `collie`).
3. Click **Install**, then open any `.collie` file.

> If the extension is not published yet, use the VSIX workflow below while developing.

### From a `.vsix` file

1. Clone this repository.

2. Install dependencies and package the extension:

   ```bash
   pnpm install
   pnpm package
   ```

   This produces `collie-vscode-<version>.vsix` in the repo root.

3. In VS Code:
   **Extensions panel -> ... menu -> Install from VSIX...**
   Select the generated `.vsix`.

4. Reload VS Code and open a `.collie` file to confirm activation.

---

## Getting Started

1. **Create your first `.collie` file (each template starts with `#id`)**

   ```collie
   #id Hero

   #inputs
     title
     onCtaClick()

   classes
     cta = px-4.py-2.rounded.bg-emerald-600.text-white

   div.hero
     h1 {title}
     button.$cta(onClick={onCtaClick})
       | Get started
   ```

2. **Set Collie as the default formatter for `.collie` files**

   Add this to your workspace or user settings:

   ```jsonc
   "[collie]": {
     "editor.defaultFormatter": "collie.collie-vscode",
     "editor.formatOnSave": true
   }
   ```

3. **Save the file**
   You should see:

   - Collie syntax coloring
   - Semantic colors for tags/inputs/directives
   - Collie file icon in the Explorer

---

## Language and Editor Features

### Syntax Highlighting

Tokenization via `collie.tmLanguage.json` for:

- Comments and strings
- `#id`, `#inputs`, and `classes` blocks
- Directives (`@if/@elseIf/@else/@for`)
- Expression lines (`= expr`) and inline expressions (`{}` / `{{}}`)
- Tag names and class shorthands
- Pipe text lines

> Semantic tokens refine the colors and cover additional syntax details.

---

### Semantic Highlighting

The extension exposes semantic token types:

- `collieTag`
- `collieClassShorthand`
- `collieDirective`
- `collieInputsKeyword`
- `collieInputsField`
- `collieInputsFieldFn`
- `collieInterpolation`
- `colliePipeText`
- `collieComment`
- `collieClassesKeyword`
- `collieClassAliasName`
- `collieClassAliasUsage`
- `collieForLoop`
- `collieExpressionLine`
- `collieComponent`
- `collieSingleBraceInterpolation`
- `collieIdKeyword`
- `collieIdValue`
- `collieEventHandler`

Out of the box, Collie enables semantic highlighting for `[collie]` and provides defaults:

```jsonc
"[collie]": {
  "editor.semanticHighlighting.enabled": true,
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "collieTag": { "foreground": "#6CB6FF" },
      "collieComponent": { "foreground": "#FFD580" },
      "collieClassShorthand": { "foreground": "#4EC9B0" },
      "collieClassesKeyword": { "foreground": "#C586C0" },
      "collieClassAliasName": { "foreground": "#F26D6D" },
      "collieClassAliasUsage": { "foreground": "#4EC9B0" },
      "collieDirective": { "foreground": "#C586C0" },
      "collieForLoop": { "foreground": "#C586C0", "fontStyle": "italic" },
      "collieInputsKeyword": { "foreground": "#B39DF3" },
      "collieInputsField": { "foreground": "#E0AF68" },
      "collieInputsFieldFn": { "foreground": "#9ECE6A" },
      "collieEventHandler": { "foreground": "#6CB6FF", "fontStyle": "bold" },
      "collieInterpolation": { "foreground": "#FFD580", "fontStyle": "bold" },
      "collieSingleBraceInterpolation": { "foreground": "#E6C27A" },
      "collieExpressionLine": { "foreground": "#AAB2BF" },
      "colliePipeText": { "foreground": "#D4D4D4" },
      "collieComment": { "foreground": "#636B78", "fontStyle": "italic" },
      "collieIdKeyword": { "foreground": "#C586C0" },
      "collieIdValue": { "foreground": "#F26D6D", "fontStyle": "bold" }
    }
  }
}
```

You can override these like any other semantic token rules.

---

### Formatting

The Collie formatter parses your template into an AST and reprints it with consistent rules:

- Normalizes indentation for nested elements and blocks
- Keeps selectors compact or spaced based on settings
- Normalizes `#inputs` spacing
- Handles `classes` and directives without breaking structure

Key behaviors:

- **Whole-document formatting** is supported (internal `DocumentFormattingEditProvider`).
- **Range/selection formatting** is not implemented yet; use document formatting for now.
- If the AST formatter fails, an indentation-only **fallback formatter** runs instead.

---

### Diagnostics

When enabled, Collie will:

- Parse `.collie` files as you edit
- Surface parser diagnostics in the **Problems** panel
- Highlight invalid or unsupported constructs inline

Current diagnostics include:

- Parser errors and warnings from the Collie grammar
- Unknown directives and dialect spellings like `@else-if`
- Duplicate inputs in a `#inputs` block
- Duplicate `#id` collisions across the workspace
- Templates not referenced by `<Collie id="...">` or HTML placeholders
- Inputs used but not declared in the `#inputs` block
- Unknown CSS classes when a CSS index is enabled
- Unknown `<Collie id="...">` references in TSX/JSX
- Optional React integration diagnostics when `collie.inputs.reactIntegration.enabled` is enabled

Quick fixes are available for several diagnostics (dialect token normalization, add missing inputs,
rename conflicting IDs, ignore diagnostics, and "Fix all Collie issues").

You can suppress diagnostics with directives:

```collie
// collie-ignore-next-line COLLIE501
// collie-ignore-file COLLIE405
```

`#collie-ignore-*` variants are also supported.

Diagnostics are throttled to avoid blocking your typing and are driven by the same parser used for formatting and other features.

---

### Navigation

Collie navigation includes:

- **Document Symbols**
  Outline entries for:
  - Each `#id` template block
  - `#inputs`
  - Elements / blocks
  - Conditionals (`@if/@elseIf/@else`)
  - Loop constructs (`@for`)
- **Workspace Symbols**
  - Search for templates by `#id` via Cmd/Ctrl+T
- **Go to Definition**
  - Component tags -> sibling `.collie` or `.tsx` files
  - `#id` values -> matching HTML placeholders (`id="...-collie"`)
  - `<Collie id="...">` in TSX/JSX -> template definitions
  - HTML placeholders -> template definitions
  - Class shorthand tokens -> CSS definitions (when CSS indexing is enabled)
- **Open Compiled HTML Partial**
  Use `Collie: Open Compiled HTML Partial` to open `collie/dist/<id>.html` under the workspace root.
  The `<id>` comes from the active `#id` directive; multiple templates in one file each compile to their own
  `collie/dist/<id>.html`.

The definition provider uses simple, predictable heuristics and a short-lived cache so it stays responsive even in larger projects.

---

### Hover

Hovers provide quick inline help:

- Directives: explanation of `@if`, `@elseIf`, `@else`, `@for`
- `#inputs` and input fields: context and field name
- `classes` blocks: alias declarations and usages
- Interpolations and expression lines: highlight the expression span

This is intentionally lightweight "tool-tip" style help that does not try to replace full language-server docs.

---

### Completions

Completion items include:

- **Directives:** `@if`, `@elseIf`, `@else`, `@for`
- **Tags and components:**
  - Common HTML tags
  - Project components discovered from sibling `.collie`/`.tsx` files
- **Class aliases:** names declared under `classes` (type `$` to trigger)
- **Template IDs:**
  - `<Collie id="...">` values in TSX/JSX
  - `id="...-collie"` placeholders in HTML

The provider aims to be helpful without being noisy: items are filtered and sorted so what you use stays near the top.

---

### JSX/TSX Interop

#### Convert JSX/TSX Selection to Collie

Use the command:

> **Collie: Convert JSX/TSX Selection to Collie**

Workflow:

1. In a `*.tsx` or `*.jsx` file, select the JSX you want to convert
   - Multi-node selections are supported; the extension wraps them into a temporary root.
2. Run the command from the Command Palette, or use the editor context menu action **Convert to Collie**
   (only shown when a JSX/TSX selection exists).
3. The extension:
   - Parses the JSX selection with TypeScript
   - Converts it to an intermediate representation
   - Prints Collie output
   - Logs details to the **"Collie Conversion"** output channel
4. The extension creates or appends a `#id <id>` block in a `.collie` file next to the source (same basename,
   or parent folder name for `index`). `.collie` files can contain multiple templates separated by `#id`.
5. The extension builds a `#inputs` block from identifier usage and replaces the selection with
   `<Collie id="<id>" />` or `<Collie id="<id>" inputs={{ ... }} />`. It also ensures
   `import { Collie } from '@collie-lang/react'` exists.
6. If a file cannot be created, the output is copied to your clipboard and opened in a preview editor instead.

Unsupported constructs are never silently dropped; any issues are surfaced as warnings in the output channel.

#### Copy Collie as JSX / TSX

Two additional commands:

- **Collie: Copy as JSX**
- **Collie: Copy as TSX**

From an open `.collie` document, these commands:

- Parse and convert the template back into JSX/TSX
- Copy the generated component to your clipboard
- Log details to the **"Collie Export"** output channel
- Prefer readable, strict-friendly TSX when applicable (e.g. `function Component(): JSX.Element`)

This gives you a reversible path between Collie templates and traditional JSX.

---

## File Icons

Collie ships with a minimal file icon theme:

- All `.collie` files get a custom **Collie file icon** in the Explorer.
- The icon theme is registered as `collie-icons` but automatically applied when this extension is active.

> Optional: In VS Code settings, you can explicitly choose the Collie icon theme if you want to enforce it.

---

## Settings

All settings are namespaced under `collie.*`.

| Setting                                       | Default   | Description                                                                                      |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `collie.logging.enabled`                      | `false`   | Enable verbose logging for the extension (useful when debugging activation or feature behavior). |
| `collie.semanticTokens.enabled`               | `true`    | Toggle Collie semantic token highlighting on/off.                                                |
| `collie.features.diagnostics`                 | `true`    | Enable diagnostics (Problems panel integration).                                                 |
| `collie.features.completions`                 | `true`    | Enable completions (directives, tags, class aliases, template IDs).                              |
| `collie.features.navigation`                  | `true`    | Enable navigation (symbols, go to definition, HTML placeholders).                                |
| `collie.features.hover`                       | `true`    | Enable hover info (directives, inputs, expressions, class aliases).                              |
| `collie.format.indentSize`                    | `2`       | Number of spaces per indentation level when formatting.                                          |
| `collie.format.preferCompactSelectors`        | `true`    | Print selectors like `div.foo.bar` instead of inserting spaces before class shorthands.          |
| `collie.format.spaceAroundPipe`               | `true`    | Insert a space between the pipe symbol and inline/standalone text.                               |
| `collie.format.normalizeInputsSpacing`        | `true`    | Normalize inputs declarations to a single space after the colon.                                 |
| `collie.css.diagnostics.unknownClassOverride` | `inherit` | Override unknown class diagnostics from Collie config (`inherit`/`on`/`off`).                     |
| `collie.inputs.reactIntegration.enabled`      | `false`   | Enable experimental React integration diagnostics for Collie inputs.                             |
| `collie.warnings.missingConfig.enabled`       | `true`    | Show a one-time warning when no `collie.config.*` is found in the workspace.                     |
| `collie.warnings.missingPackages.enabled`     | `true`    | Show a one-time warning when required `@collie-lang/*` packages appear to be missing.            |
| `collie.warnings.throttleMinutes`             | `1440`    | Minimum minutes between repeated warning notifications per workspace (default: 1 day).          |

You can also group the feature flags under a single object in `settings.json`:

```jsonc
"collie.features": {
  "diagnostics": true,
  "navigation": true,
  "hover": true,
  "completions": true
}
```

> If something feels too noisy, try disabling just one feature at a time to see how it affects your workflow.

---

## Commands

All canonical commands are available via the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) under
"Collie: ...". Some short context-menu aliases (like "Convert to Collie") are hidden from the palette.

**Customization**

- `Collie: Customize Token Color`
- `Collie: Customize Tag Color`
- `Collie: Customize Directive Color`
- `Collie: Customize Inputs Field Color`
- `Collie: Customize Class Shorthand Color`
- `Collie: Reset Token Customization`
- `Collie: Copy Token Customization Snippet`

**Conversion and Export**

- `Collie: Convert JSX/TSX Selection to Collie`
- `Collie: Copy as JSX`
- `Collie: Copy as TSX`

**Navigation and CSS**

- `Collie: Open Compiled HTML Partial`
- `Collie: Rebuild CSS Index`
- `Collie: Show Current Config (for this file)`
- `Collie: Toggle CSS Unknown Class Diagnostics`

**Context menu shortcuts (editor right-click)**

- `Convert to Collie` (only when a JSX/TSX selection exists)
- `Convert to TSX (Copy to Clipboard)` (only in `.collie` files)
- `Customize Token Color` (only in `.collie` files)
- `Reset Token Customization` (only in `.collie` files)

---

## Known Limitations

- **Language version drift** - The extension tracks the Collie parser bundled in the repo. If the language syntax evolves, you may need to update the extension to match.
- **No range formatting (yet)** - Only full-document formatting is supported. Use `Format Document` or format-on-save.
- **Heuristic navigation** - Go to Definition uses simple sibling/nearby file heuristics and is not a full project-wide indexer.
- **Best-effort conversions** - JSX to Collie and Collie to JSX/TSX are designed to be safe and transparent, not perfect. Always skim the output for edge cases.

---

## Roadmap

Planned improvements include:

- Range/selection formatting
- Smarter formatter behaviors as the printer matures
- Richer diagnostics and quick fixes
- Deeper navigation/completion smarts
- Possible evolution toward a shared language server once the Collie tooling ecosystem stabilizes

---

## Contributing and Feedback

Issues, ideas, and bug reports are welcome.

- **Bugs / feature requests:**
  Open an issue in this repository with a minimal `.collie` example and a short description of what you expected vs what happened.
- **Contributing code:**
  See [CONTRIBUTING.md](CONTRIBUTING.md) for code organization guidelines, file structure patterns, and development setup.

If you are using Collie in a real project, feedback on what worked well and what did not will heavily influence how this extension evolves.
