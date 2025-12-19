# Collie – VS Code Support for Collie Templates

VS Code language support for **Collie**, a JSX-adjacent templating language for React-style components.

> Collie lets you write clean, indentation-based templates (think Pug-ish) that still map cleanly back to JSX/TSX.

---

![Collie hero screenshot – syntax + outline](assets/readme/collie-hero.png)
*Placeholder – Capture a `.collie` file in Dark+ showing semantic highlighting, the document outline, and the Problems panel with a couple of diagnostics.*

---

## Features

Collie for VS Code is a single, lightweight extension that provides:

- **Language basics**
  - `.collie` file association and syntax highlighting
  - Collie-specific comments, indentation, and bracket behavior
  - Custom **file icon** for `.collie` templates in the Explorer

- **Semantic highlighting**
  - Token-aware colors for:
    - Tags and components
    - Class shorthands (e.g. `div.button.primary`)
    - `#props` and props fields
    - `#classes` and class aliases
    - Directives (`@if`, `@elseIf`, `@else`, `@for`)
    - Interpolations (`{{ }}` and single-brace variants)
    - Pipe text (`| some text`)
    - Comments
  - Ships with Dark+-style defaults and works with your theme’s semantic tokens

- **Formatting**
  - Document formatter that understands the Collie AST
  - Configurable:
    - Indentation width
    - Compact vs spaced selectors
    - Spacing around the pipe (`|`)
    - Normalized props spacing
  - Safe fallback formatter for malformed files (normalizes indentation only)

- **Editor ergonomics (experimental but on by default)**
  - **Diagnostics** in the Problems panel based on the Collie parser
  - **Document outline** for elements, props, loops, and branches
  - **Go to Definition** for components between `.collie` and `.tsx`
  - **Hover** help for directives, props, and expressions
  - **Completions** for directives, tags/components, and class aliases

- **JSX/TSX interop**
  - Convert a JSX/TSX selection into a `.collie` template
  - Copy a `.collie` file as JSX or TSX to paste into React code
  - Detailed conversion logs in a **Collie Conversion** output channel

---

![Collie semantic tokens close-up](assets/readme/collie-semantic-tokens.png)
*Placeholder – Zoomed-in screenshot of tags, props, directives, `#classes`, and `{{ }}` with distinct token colors.*

---

## What Is Collie?

Collie is an indentation-based template language designed to play nicely with React and TSX:

```collie
#props
  user: User
  isEditing: boolean

#classes
  primaryButton = "bg-sky-600 text-white px-4 py-2 rounded"

div.profile-card
  h2 {{ user.name }}
  p.subtitle
    | {{ user.title }}

  if @if (isEditing)
    button.primaryButton
      | Save changes
  @else
    button.primaryButton
      | Edit profile
```

Core ideas:

* **Indentation instead of closing tags** — cleaner, more readable markup.
* **Strong mapping back to JSX/TSX** — easy conversion in both directions.
* **First-class ergonomics** like `#props`, `#classes`, tagging, and structured directives.

> For full language docs and philosophy:
> **TODO:** Add link to the main Collie language docs / repo here.

---

## Installation

### From the VS Code Marketplace

1. Open the **Extensions** view in VS Code.
2. Search for **“Collie”** (publisher: `collie`).
3. Click **Install**, then open any `.collie` file.

> If the extension isn’t published yet, use the VSIX workflow below while developing.

### From a `.vsix` file

1. Clone this repository.

2. Install dependencies and package the extension:

   ```bash
   pnpm install
   pnpm package
   ```

   This produces `collie-vscode-<version>.vsix` in the repo root.

3. In VS Code:
   **Extensions panel → … menu → Install from VSIX…**
   Select the generated `.vsix`.

4. Reload VS Code and open a `.collie` file to confirm activation.

---

## Getting Started

1. **Create your first `.collie` file**

   ```collie
   #props
     title: string

   div.hero
     h1 {{ title }}
     p
       | Welcome to Collie in VS Code!
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

   * Collie syntax coloring
   * Semantic colors for tags/props/directives
   * Collie file icon in the Explorer

---

![Format-on-save demo gif](assets/readme/collie-format-on-save.gif)
*Placeholder – Short GIF showing a messy `.collie` file being cleaned up on save, including `#props`, `#classes`, and directives.*

---

## Language & Editor Features

### Syntax Highlighting

* Tokenization via `collie.tmLanguage.json` for:

  * Comments
  * Directives (`@if/@elseIf/@else/@for`)
  * `#props` and its fields
  * `#classes` and alias declarations/usages
  * Element tags and components
  * Interpolations (`{{ expr }}` and single-brace variants)
  * Pipe text lines

> Works even if semantic tokens are disabled; semantic tokens refine the colors and mapping.

---

### Semantic Highlighting

The extension exposes semantic token types:

* `collieTag`
* `collieComponent`
* `collieClassShorthand`
* `collieDirective`
* `colliePropsKeyword`
* `colliePropsField`
* `collieClassesKeyword`
* `collieClassAliasName`
* `collieClassAliasUsage`
* `collieInterpolation`
* `collieSingleBraceInterpolation`
* `colliePipeText`
* `collieComment`
* `collieForLoop`
* `collieExpressionLine`

Out of the box, Collie enables semantic highlighting for `[collie]` and provides Dark+-friendly colors:

```jsonc
"[collie]": {
  "editor.semanticHighlighting.enabled": true,
  "editor.semanticTokenColorCustomizations": {
    "rules": {
      "collieTag": "#569CD6",
      "collieClassShorthand": "#4EC9B0",
      "collieDirective": "#C586C0",
      "colliePropsKeyword": "#D7BA7D",
      "colliePropsField": "#9CDCFE",
      "collieInterpolation": "#CE9178",
      "colliePipeText": "#D4D4D4",
      "collieComment": "#6A9955",
      "collieClassesKeyword": "#D7BA7D",
      "collieClassAliasName": "#4FC1FF",
      "collieClassAliasUsage": "#4EC9B0"
    }
  }
}
```

You can override these like any other semantic token rules.

---

### Formatting

The Collie formatter parses your template into an AST and reprints it with consistent rules:

* Normalizes indentation for nested elements and blocks
* Keeps selectors compact or spaced based on settings
* Normalizes `#props` spacing
* Handles `#classes` and directives without breaking structure

Key behaviors:

* **Whole-document formatting** is supported (internal `DocumentFormattingEditProvider`).
* **Range/selection formatting** is not implemented yet; use document formatting for now.
* If the AST formatter fails, an indentation-only **fallback formatter** runs instead, rather than leaving you with a broken file.

---

### Diagnostics (Experimental)

When enabled, Collie will:

* Parse `.collie` files as you edit
* Surface parser diagnostics in the **Problems** panel
* Highlight invalid or unsupported constructs inline

Diagnostics are deliberately throttled to avoid blocking your typing and are driven by the same parser used for formatting and other features.

---

### Navigation (Experimental)

Collie navigation currently includes:

* **Document Symbols**
  Outline view entries for:

  * The root template
  * `#props`
  * Elements / blocks
  * Conditionals (`@if/@elseIf/@else`)
  * Loop constructs (`@for`)

* **Go to Definition for components**
  From a component-like tag in a `.collie` file, Collie will search for:

  * Sibling `.collie` files
  * Sibling `.tsx` files
  * Matching names in the same or sibling directories
    and jump to the matching component when found.

The definition provider uses simple, predictable heuristics and a short-lived cache so it stays responsive even in larger projects.

---

### Hover (Experimental)

Hovers provide quick inline help:

* Directives: explanation of `@if`, `@elseIf`, `@else`, `@for`
* `#props` and prop fields: context and field name/shape
* Interpolations and expression lines: highlight the span of the expression
* `#classes` blocks: alias declarations and usages

This is intentionally lightweight “tool-tip” style help that doesn’t try to replace full language-server docs.

---

### Completions (Experimental)

Completion items include:

* **Directives:** `@if`, `@elseIf`, `@else`, `@for`
* **Tags & components:**

  * HTML-like tags
  * Project components discovered from sibling `.collie`/`.tsx` files
* **Class aliases:** names declared under `#classes`

The provider tries to be helpful without being noisy: items are filtered and sorted so directives and components you actually use stay near the top.

---

### JSX/TSX Interop

#### Convert JSX/TSX Selection to Collie

Use the command:

> **Collie: Convert JSX/TSX Selection to Collie**

Workflow:

1. In a `*.tsx` or `*.jsx` file, select the JSX you want to convert

   * Multi-node selections are supported; the extension wraps them into a temporary root.
2. Run the command from the Command Palette.
3. The extension:

   * Parses the JSX selection with TypeScript
   * Converts it to an intermediate representation
   * Prints Collie output
   * Logs details to the **“Collie Conversion”** output channel
4. You’ll be prompted to:

   * Create a `.collie` file next to the source component, **or**
   * Open the generated Collie snippet in an untitled editor for review

Unsupported constructs are never silently dropped; any issues are surfaced as warnings in the output channel.

#### Copy Collie as JSX / TSX

Two additional commands:

* **Collie: Copy as JSX**
* **Collie: Copy as TSX**

From an open `.collie` document, these commands:

* Parse and convert the template back into JSX/TSX
* Copy the generated component to your clipboard
* Prefer readable, strict-friendly TSX when applicable (e.g. `function Component(): JSX.Element`)

This gives you a reversible path between Collie templates and traditional JSX.

---

![JSX ⇄ Collie conversion gif](assets/readme/collie-conversion.gif)
*Placeholder – GIF showing selecting JSX in a `.tsx` file, running “Convert JSX/TSX Selection to Collie”, inspecting the output, then saving a new `.collie` file.*

---

## File Icons

Collie ships with a minimal file icon theme:

* All `.collie` files get a custom **Collie file icon** in the Explorer.
* The icon theme is registered as `collie-icons` but automatically applied when this extension is active.

> **Optional:** In VS Code settings, you can explicitly choose the Collie icon theme if you want to enforce it.

---

## Settings

All settings are namespaced under `collie.*`.

| Setting                                | Default | Description                                                                                      |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| `collie.logging.enabled`               | `false` | Enable verbose logging for the extension (useful when debugging activation or feature behavior). |
| `collie.semanticTokens.enabled`        | `true`  | Toggle Collie semantic token highlighting on/off.                                                |
| `collie.features.diagnostics`          | `true`  | Enable experimental diagnostics (Problems panel integration).                                    |
| `collie.features.completions`          | `true`  | Enable experimental completions (directives, tags, components, aliases).                         |
| `collie.features.navigation`           | `true`  | Enable experimental navigation (document symbols, Go to Definition).                             |
| `collie.features.hover`                | `true`  | Enable experimental hover info (directives, props, expressions).                                 |
| `collie.format.indentSize`             | `2`     | Number of spaces per indentation level when formatting.                                          |
| `collie.format.preferCompactSelectors` | `true`  | Print selectors like `div.foo.bar` instead of inserting spaces before class shorthands.          |
| `collie.format.spaceAroundPipe`        | `true`  | Insert a space between the pipe symbol and inline/standalone text.                               |
| `collie.format.normalizePropsSpacing`  | `true`  | Normalize props declarations to a single space after the colon.                                  |

You can also group the feature flags under a single object in `settings.json`:

```jsonc
"collie.features": {
  "diagnostics": true,
  "navigation": true,
  "hover": true,
  "completions": true
}
```

> If something feels too noisy or experimental, try disabling just one feature at a time to see how it affects your workflow.

---

## Commands

All commands are available via the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`) under “Collie: …”.

**Customization**

* `Collie: Customize Token Color`
* `Collie: Customize Tag Color`
* `Collie: Customize Directive Color`
* `Collie: Customize Props Field Color`
* `Collie: Customize Class Shorthand Color`
* `Collie: Reset Token Customization`
* `Collie: Copy Token Customization Snippet`

These commands help you tweak semantic token colors and styles. They:

* Infer the token type from the cursor position when possible
* Prompt you for a color and style (bold/italic/underline)
* Write the customization to the appropriate settings target (user/workspace)

**Conversion**

* `Collie: Convert JSX/TSX Selection to Collie`
* `Collie: Copy as JSX`
* `Collie: Copy as TSX`

---

## Known Limitations

* **Language version drift** – The extension tracks the Collie parser bundled in the repo. If the language syntax evolves, you may need to update the extension to match.
* **No range formatting (yet)** – Only full-document formatting is supported. Use `Format Document` or format-on-save.
* **Heuristic navigation** – Go to Definition uses simple sibling/nearby file heuristics and is not a full project-wide indexer.
* **Best-effort conversions** – JSX ⇄ Collie conversion is designed to be safe and transparent, not perfect. Always skim the output for edge cases.

---

## Roadmap

Planned improvements include:

* Range/selection formatting
* Smarter formatter behaviors as the printer matures
* Richer diagnostics and quick fixes
* Deeper navigation/completion smarts
* Possible evolution toward a shared language server once the Collie tooling ecosystem stabilizes

---

## Contributing & Feedback

Issues, ideas, and bug reports are very welcome.

* **Bugs / feature requests:**
  Open an issue in this repository with a minimal `.collie` example and a short description of what you expected vs what happened.

* **Language questions:**
  TODO: Add link to the main Collie language docs / discussion forum / Discord here.

If you’re using Collie in a real project, feedback on what worked well and what didn’t will heavily influence how this extension evolves.
