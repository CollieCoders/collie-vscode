# VS Code Collie Language Extension Plan

## Context & Problem

Collie (`collie-lang`) uses a Pug-inspired, indentation-based syntax in `.collie` files. The compiler/Vite pipeline works end-to-end, but `.collie` files in VS Code are currently **unstyled gray blobs**. We want an MVP that provides **usable syntax highlighting** (not perfection), and we want **comments supported from the start** (at least at the editor-highlighting level).

## Do NOT write tests

* Do **NOT** create unit tests, integration tests, snapshots, or test harnesses for this work.
* Focus on shipping a working VS Code language extension.

## MVP Goal

* `.collie` files get:

  * Token coloring (keywords, tags/components, classes, interpolation, etc.)
  * Comment highlighting (line + block)
  * Basic editor behaviors (brackets, auto-closing pairs, indentation rules if practical)

## Key MVP Design Decisions

* **VS Code only** for now (no cross-editor packaging).
* **Track current parser rules only**; grammar can evolve later.
* Comments: implement **JS-style comments** in the highlighter:

  * Line: `// ...`
  * Block: `/* ... */`

This is the least controversial and most ergonomic for JSX-adjacent syntax. (If you later want `#` or Pug-style comments, we can add patterns.)

---

# Stage 0 — Create a dedicated extension workspace

### Objective

Create a separate folder/repo for the VS Code extension so it can ship independently of the compiler and Vite plugin.

### Deliverables

* New folder/repo (choose one):

  * `collie-vscode/` (recommended)
  * or inside monorepo as `packages/vscode-collie/` (fine, but more release plumbing)
* README with quick usage steps (“Install vsix / Run Extension / Open `.collie` file”).

### User Pre-Flight Checklist

* Decide where you want this to live:

  * ✅ Separate repo: simplest distribution and VS Code dev loop
  * ✅ Monorepo package: easier to keep in sync, but publishing is slightly fussier

### Implementation Notes for the Agent

* If separate repo: initialize `package.json`, `.gitignore`, `README.md`.
* If monorepo: ensure pnpm workspace config won’t fight with `vsce` packaging later.

### User Acceptance Checklist

* You can open the folder alone in VS Code without monorepo dependency confusion.
* The folder is “extension-ready” (clean root, no unrelated packages).

---

# Stage 1 — Scaffold a VS Code language extension (no grammar yet)

### Objective

Generate a minimal VS Code extension that registers a language for `.collie`.

### Deliverables

* A working VS Code extension scaffold containing:

  * `package.json` with `contributes.languages`
  * `language-configuration.json` (basic)
  * `src/extension.ts` can be empty/minimal (no activation logic needed for TextMate-only)
  * `tsconfig.json` / build scripts as needed (or pure JSON-only extension if you want to minimize code)

### Recommended scaffolding approach

* Use `yo code` **or** manually author a minimal extension. Either is fine.
* Keep it as a “Language Support” extension, not a full-featured extension.

### Required `package.json` contributions (MVP)

* Language registration:

  * language id: `collie`
  * file extensions: `[".collie"]`
  * aliases: `["Collie", "collie"]`

### `language-configuration.json` (MVP)

* Comments:

  * lineComment: `//`
  * blockComment: `/* */`
* Brackets / autoClosingPairs:

  * `{ }`, `[ ]`, `( )`
  * `{{ }}` (optional but nice; if you add it, ensure it doesn’t annoy you)
  * quotes: `" "`, `' '`

### User Pre-Flight Checklist

* Install prerequisites (only if using generator):

  * Node LTS + npm/pnpm
  * `yo` + `generator-code` (if you choose generator)
* Decide: TypeScript extension project vs “no code” extension.

  * ✅ For this MVP, “no runtime code” is best (lighter, less maintenance).
  * You can still keep a TS scaffold if you prefer.

### User Acceptance Checklist

* Press `F5` (Run Extension) and open a `.collie` file in the Extension Development Host.
* VS Code recognizes the file language mode as **Collie** (bottom-right language indicator).

---

# Stage 2 — Add a TextMate grammar file and wire it up

### Objective

Create a TextMate grammar that highlights the core Collie constructs.

### Deliverables

* `syntaxes/collie.tmLanguage.json`
* `package.json` updated with `contributes.grammars` linking:

  * language: `collie`
  * scopeName: e.g. `source.collie`
  * path: `./syntaxes/collie.tmLanguage.json`

### Tokenization priorities (MVP “big wins”)

Focus on high-value scopes that themes already color nicely:

1. **Comments**

   * `// ...` → `comment.line.double-slash.collie`
   * `/* ... */` → `comment.block.collie`

2. **Control keywords**

   * `@if`, `@elseIf`, `@else` → `keyword.control.collie`

3. **`props` header**

   * `props:` line head or `props` token → `keyword.other.props.collie`

4. **Interpolation blocks**

   * `{{` and `}}` punctuation → `punctuation.section.embedded.collie`
   * content inside → `source.js.embedded.collie` (best effort)

5. **Text line marker**

   * Leading `|` → `punctuation.definition.string.collie`
   * remaining text can be `string.quoted.other.collie`-ish (or plain `string.unquoted.collie`)

6. **Element/component head**

   * First token on a line like `div` / `Button` / `MyComponent` → `entity.name.tag.collie` (or `support.class.collie` for capitalized if you want)
   * Class shorthand `.foo` segments → `entity.other.attribute-name.class.collie`

### Grammar structure guidance (for the agent)

Use a repository-based grammar with:

* `#comments`
* `#interpolation`
* `#directives`
* `#propsSection`
* `#tagLine`
* `#textLine`

Ensure `#comments` is applied early/high-priority so comments “win” tokenization.

### User Pre-Flight Checklist

* None beyond Stage 1.

### User Acceptance Checklist

* In Extension Dev Host:

  * `@if (...)` is colored like a keyword.
  * `props:` stands out.
  * `.some-class` segments are colored as class names.
  * `{{something}}` is visibly distinct (delimiters + inner expression).
  * `// comment` and `/* comment */` highlight correctly.

---

# Stage 3 — Shape the grammar to match Collie’s actual syntax rules

### Objective

Make the grammar reflect the real-world Collie rules you have today, without trying to parse everything perfectly.

### Deliverables

* Updated `collie.tmLanguage.json` patterns that match:

  * **2-space indentation style** (highlighting doesn’t need to enforce it, but avoid patterns that break on indentation)
  * `.class` segments both in “attached” (`Button.primary`) and “spaced” (`.primary`) forms
  * `props` fields like: `name?: SomeType` (highlight name, optional marker `?`, and type portion)
  * `@elseIf` casing exactly (or accept `@elseif` if you want future-friendly; your call)

### Suggested refinements (MVP-safe)

* `props` block:

  * Highlight the keyword `props` when it appears at start of line
  * Highlight field names at start of indented lines following `props`
  * Highlight `?` optional marker as punctuation
  * Highlight type portion after `:` as `storage.type` or `support.type` (best effort)

* Directives:

  * `@if\s*\(` … `\)` treat parens as punctuation, inner as embedded JS best effort

* Text lines:

  * Support `| ... {{ expr }} ...` where interpolation can occur inside text

### User Pre-Flight Checklist

* Collect a few representative `.collie` examples from your real codebase (5–10 files).

  * You don’t need to paste them here; just have them handy for validation in the Dev Host.

### User Acceptance Checklist

* Your real `.collie` examples look “meaningfully highlighted,” especially:

  * props fields
  * directives
  * class shorthand
  * interpolation

---

# Stage 4 — Add editor behavior polish (configuration + small UX wins)

### Objective

Make editing Collie feel less raw, without adding heavy features.

### Deliverables

* Improved `language-configuration.json`:

  * `indentationRules` (optional; only if it helps and doesn’t get annoying)
  * `onEnterRules` (optional; helps maintain indentation)
  * autoClosingPairs for `{{` `}}` (optional)

### Practical MVP choices

* Keep it minimal:

  * Comments + brackets + quote auto-closing is enough
* Indentation rules can be finicky; only add if you’re confident it won’t misbehave.

### User Pre-Flight Checklist

* Decide whether you want VS Code to auto-close `{{` to `}}`.

  * Some people love it; some hate it. If unsure, skip for MVP.

### User Acceptance Checklist

* Typing `(`, `{`, `[` auto-closes.
* Comments toggle works properly if you hit the comment shortcut on a line.
* Editing feels “normal” in `.collie` files.

---

# Stage 5 — Packaging and distribution (local vsix + optional Marketplace readiness)

### Objective

Make it easy to install on your main machine and share with others.

### Deliverables

* A repeatable packaging flow:

  * `vsce package` producing a `.vsix`
  * Install via “Extensions: Install from VSIX…”
* Versioning plan (simple semver)
* Icon + basic metadata (optional but nice)

### Minimal metadata to include

* `name`, `displayName`, `publisher` (for marketplace later)
* `description`, `repository`
* `engines.vscode`
* `categories`: `["Programming Languages"]`

### User Pre-Flight Checklist

* If you want Marketplace later, you’ll need a publisher account.
* For now, VSIX-only is fine.

### User Acceptance Checklist

* You can build a `.vsix`, install it into your real VS Code, and `.collie` files highlight without the Dev Host.

---

# Stage 6 — Maintenance hooks for future Collie syntax (lightweight process)

### Objective

Keep the grammar from drifting as Collie evolves, without over-engineering.

### Deliverables

* A “Grammar Update Checklist” section in README:

  * When adding syntax to Collie, update TextMate rules
  * Add one example snippet per feature to a `samples/` folder (not tests—just examples)
* A tiny “Known Limitations” list:

  * TextMate grammar is regex-based; doesn’t fully parse JS inside `{{ }}`

### User Pre-Flight Checklist

* None.

### User Acceptance Checklist

* You have a clear way to evolve highlighting incrementally without turning this into a huge project.

---

## Notes for Copilot/Codex/Roo Code execution

When you tell an agent to implement a stage, include:

* The stage number
* “Do NOT write tests”
* “Do not change Collie compiler or Vite plugin code” (unless you later decide to support comments in the compiler too)

Example command to your agent:

> Implement Stage 2 of the VS Code Collie language extension plan. Do NOT write tests. Only change files inside the VS Code extension project.