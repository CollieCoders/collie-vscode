# Collie VS Code Language Extension – MVP Implementation Plan

## Context & Problem

Collie (`collie-lang`) is a JSX-adjacent, indentation-based templating language inspired by Pug, stored in `.collie` files. The compiler and Vite plugin are now working end-to-end, but `.collie` files in VS Code currently render as an unstyled gray blob.

The goal of this project is to create a **VS Code language extension** that provides:

* Syntax highlighting for `.collie` files
* Comment support from day one
* Basic editor behavior (brackets, comments, auto-closing)
* A project structure that is **ready for future language features** (formatting, diagnostics, etc.)

This is an **MVP focused on momentum**, not perfection.

---

## Explicit Constraints

### Do NOT write tests

* Do **NOT** add unit tests, integration tests, snapshots, or test harnesses.
* This project intentionally ships without tests at this stage.

### Scope boundaries

* Do **NOT** modify:

  * `@collie-lang/compiler`
  * `@collie-lang/vite`
* This extension is editor-only.

---

## MVP Goals

By the end of this plan:

* `.collie` files in VS Code are syntax-highlighted
* Comments (`//` and `/* */`) work
* The extension can be installed via `.vsix`
* The codebase is structured to later support:

  * formatting
  * diagnostics
  * hover/completions
  * potential language server integration

---

## Technology Decisions (Locked)

* **Editor**: VS Code only
* **Package manager**: `pnpm`
* **Language**: TypeScript
* **Bundler**: `esbuild`
* **Extension host output format**: **CommonJS (CJS)**
* **Syntax highlighting**: TextMate grammar
* **Comments**: JavaScript-style (`//`, `/* */`)

> Note: CommonJS is used **only** for the extension host bundle to avoid VS Code / Node compatibility issues. Source code may use modern ES syntax freely.

---

## Recommended Repository

Create a **separate repository**:

```
collie-vscode
```

This keeps the extension lifecycle clean and avoids coupling with the compiler/Vite plugin.

---

## Recommended Folder & File Structure

```
collie-vscode/
  .vscode/
    launch.json
    tasks.json

  syntaxes/
    collie.tmLanguage.json

  src/
    extension.ts
    features/
      formatting/
        formatProvider.ts

  language-configuration.json

  package.json
  tsconfig.json
  tsconfig.build.json
  esbuild.config.mjs

  README.md
  CHANGELOG.md
  LICENSE
  .editorconfig
  .gitignore
```

### Structure rationale

* `syntaxes/` → TextMate grammar (MVP highlighting)
* `language-configuration.json` → comments, brackets, editor behavior
* `src/extension.ts` → future runtime features (formatting, etc.)
* `src/features/*` → modular expansion without rewrites
* `esbuild.config.mjs` → fast, simple bundling

---

# Stage 0 — Repository setup

### Objective

Create the base repo and directory structure.

### Deliverables

* Repository `collie-vscode`
* Folder structure as defined above
* Empty or placeholder files where appropriate

### User Pre-Flight Checklist

* Node.js LTS installed
* `pnpm` installed globally

### User Acceptance Checklist

* Repo opens cleanly in VS Code
* No dependency on the Collie monorepo to run

---

# Stage 1 — DIY VS Code extension scaffolding (pnpm + CJS)

## Stage 1.1 — Initialize project metadata

### Objective

Create a correct, future-ready VS Code extension manifest.

### Deliverables

* `package.json` with:

#### Required fields

* `name`
* `displayName`
* `version`
* `publisher` (placeholder is fine)
* `engines.vscode`
* `categories: ["Programming Languages"]`

#### Entry point

* `main: "./dist/extension.cjs"`

#### Activation

* `activationEvents: ["onLanguage:collie"]`

#### Language contributions

* `contributes.languages`:

  * id: `collie`
  * extensions: `[".collie"]`
  * aliases: `["Collie", "collie"]`
  * configuration: `./language-configuration.json`

* `contributes.grammars`:

  * language: `collie`
  * scopeName: `source.collie`
  * path: `./syntaxes/collie.tmLanguage.json`

#### Scripts (pnpm)

* `build`
* `watch`
* `package`
* (optional) `lint`

#### Dev dependencies

* `typescript`
* `esbuild`
* `@types/vscode`
* `@vscode/vsce`

### User Acceptance Checklist

* `pnpm install` succeeds
* VS Code shows no manifest errors

---

## Stage 1.2 — TypeScript configuration

### Objective

Separate editor-time type checking from build output.

### Deliverables

* `tsconfig.json`:

  * `strict: true`
  * `module: "ESNext"`
  * `target: ES2020` (or newer)
* `tsconfig.build.json`:

  * includes only `src/**/*`
  * no emit required (esbuild handles output)

### User Acceptance Checklist

* TypeScript works correctly in editor
* Build does not rely on `tsc` emitting JS

---

## Stage 1.3 — esbuild configuration (CommonJS output)

### Objective

Bundle extension host code safely for VS Code.

### Deliverables

* `esbuild.config.mjs`:

  * entry: `src/extension.ts`
  * outfile: `dist/extension.cjs`
  * platform: `node`
  * format: `cjs`
  * external: `["vscode"]`
  * sourcemap: true

### User Acceptance Checklist

* `pnpm run build` creates `dist/extension.cjs`
* No runtime errors when launching extension

---

## Stage 1.4 — Extension entrypoint stub

### Objective

Prepare runtime hooks without implementing features yet.

### Deliverables

* `src/extension.ts`:

  * exports `activate(context)` and `deactivate()`
  * MVP behavior: no providers registered
* `src/features/formatting/formatProvider.ts`:

  * stub file only
  * comment explaining future formatting approach

### User Acceptance Checklist

* Extension activates when opening a `.collie` file
* No errors in Extension Development Host console

---

## Stage 1.5 — Language configuration (comments from day one)

### Objective

Define editor behavior for `.collie`.

### Deliverables

* `language-configuration.json`:

  * `lineComment: "//"`
  * `blockComment: ["/*", "*/"]`
  * bracket pairs: `()`, `{}`, `[]`
  * autoClosingPairs and surroundingPairs

### User Acceptance Checklist

* Toggle comment works
* Brackets auto-close

---

## Stage 1.6 — VS Code debug configuration

### Objective

Make iteration frictionless.

### Deliverables

* `.vscode/launch.json`:

  * Extension Development Host launch
* `.vscode/tasks.json`:

  * build task
  * optional watch task

### User Acceptance Checklist

* Pressing `F5` builds and launches extension

---

### Summary

Stage 1 implemented: added package metadata/scripts, TypeScript configs, esbuild bundler setup, extension stubs, language configuration, and VS Code launch/tasks files. Verified `pnpm install` and `pnpm run build` locally (using a temporary Node download purely for verification because the system Node binary aborted during this session).

---

# Stage 2 — TextMate grammar (syntax highlighting MVP)

### Objective

Add meaningful syntax highlighting for Collie syntax.

### Deliverables

* `syntaxes/collie.tmLanguage.json` with patterns for:

  * `//` and `/* */` comments (highest priority)
  * `@if`, `@elseIf`, `@else`
  * `props` keyword
  * tag/component heads
  * `.class` shorthand segments
  * `{{ ... }}` interpolation
  * `|` text lines with interpolation support

### Acceptance Checklist

* `.collie` files are no longer gray
* Keywords, classes, interpolation are clearly visible

---

### Summary

Stage 2 implemented: TextMate grammar now highlights comments, directives, the `props` keyword, tag/component heads, shorthand classes, interpolation blocks, and pipe text lines with interpolation support.

---

# Stage 3 — Grammar refinement to match current parser rules

### Objective

Align highlighting closely with how Collie actually parses today.

### Deliverables

* Highlight:

  * `props` field names
  * optional marker `?`
  * type text after `:`
  * directive parentheses
  * attached and spaced class syntax

### Acceptance Checklist

* Real-world Collie files look consistently highlighted

---

### Summary

Stage 3 implemented: grammar now highlights props field names, optional `?`, and type annotations, recognizes directive parentheses as grouped sections, and covers both attached (`div.foo`) and spaced (`.foo`) class shorthand forms.

---

# Stage 4 — Language UX polish

### Objective

Improve editing feel without over-engineering.

### Deliverables

* Optional indentation rules
* Optional `onEnterRules`
* Keep behavior conservative to avoid annoyance

### Acceptance Checklist

* Editing feels natural
* No aggressive or broken auto-indentation

---

### Summary

Stage 4 implemented: added conservative indentation rules for directives/colon-terminated lines plus On-Enter behaviors for block comments and pipe text, improving editing feel without being intrusive.

---

# Stage 5 — Packaging & installation

### Objective

Make the extension installable outside Dev Host.

### Deliverables

* `pnpm run package` produces `.vsix`
* README documents:

  * VSIX install steps
  * Dev Host usage

### Acceptance Checklist

* Extension installs in your main VS Code
* `.collie` files highlight correctly

---

### Summary

Stage 5 implemented: `pnpm run package` now produces a slim `.vsix` (documented in README along with install/dev-host steps), and a `.vscodeignore` plus repository metadata keep the published artifact tidy.

---

# Stage 6 — Future feature hooks (no implementation yet)

### Objective

Prepare for formatting and richer language tooling.

### Deliverables

* Formatting stub file already exists
* README roadmap section:

  * Formatting (planned)
  * Diagnostics (planned)
  * LSP (possible)

### Acceptance Checklist

* No structural rewrites needed to add features later

---

### Summary

Stage 6 implemented: formatting stub remains ready and README now outlines the roadmap (formatting, diagnostics, potential LSP) so future enhancements can land without structural changes.

---
