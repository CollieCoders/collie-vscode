## 1) Semantic Tokens - “Easy, intuitive syntax highlight customizer”

**Use semantic tokens + update user/workspace settings** (`settings.json`) so the user’s theme system does the rendering.

What it looks like:

* Right click on a `section` tag → “Collie: Customize color for Tag Names”
* Extension shows a simple color picker UX (palette QuickPick + hex input)
* Extension writes to (workspace or user) settings:

  * `editor.semanticTokenColorCustomizations` targeting your semantic token types (e.g. `collieTag`, `collieClass`, `collieDirective`, etc.)

Pros:

* Works across files, consistently.
* Respects theme blending and contrast rules.
* Doesn’t fight VS Code.
* Easy to export/share (workspace `.vscode/settings.json`).

Cons:

* Needs semantic tokens first (or you end up with coarse control).

---

## 2) Formatting

This is the easiest “high impact” improvement after highlighting.

Two tiers:

### Tier 1 — MVP formatter (fast, very worthwhile)

* Indentation based on nesting
* Normalize whitespace
* Ensure consistent newline rules
* Normalize `props` block formatting

This can be done without a full-blown language server. A `DocumentFormattingEditProvider` is enough.

### Tier 2 — “Prettier-level”

* Full AST-based formatting with stable output across edge cases
* Potentially a Prettier plugin / shared formatter library so the CLI and VS Code agree

**My opinion:** do Tier 1 early. It immediately reduces friction and makes Collie feel “real.”

---

## 3) “Lint-like” error handling (especially cross-file props checking)

This is the hardest on your list **if you mean “React component passes props → Collie must declare matching props.”**

There are two levels again:

### Level 1 — In-file diagnostics (doable, valuable)

* `props` block missing but props used
* duplicate prop names
* invalid identifiers
* types missing / malformed
* directives unbalanced / malformed parentheses
* indentation / structure errors if your parser can detect

This can be implemented with `vscode.languages.createDiagnosticCollection()` and running validation on document changes.

### Level 2 — Cross-file/type-aware diagnostics (hard)

“React passes `{foo}` to Collie component but Collie doesn’t declare `foo`”
To do this robustly you basically need:

* TypeScript language service integration, or
* A Language Server (LSP) that can query TS, or
* A project-level indexer that understands imports/usage patterns

**My opinion:** start with Level 1 diagnostics. Level 2 comes later when Collie usage patterns stabilize.

---

## 4) Semantic tokens (what they are + why they matter)

Think of semantic tokens as: **“highlighting that understands meaning, not just regex patterns.”**

TextMate grammar highlighting is essentially pattern-based (“this looks like a tag”). It’s good, but limited.

Semantic tokens let you say things like:

* “This identifier is a *prop name*”
* “This word is a *tag name*”
* “This `.foo` is a *class shorthand*, not a CSS class in a stylesheet”
* “This `@if` is a *directive*, and this part inside parens is an *expression*”

And then VS Code users can customize them cleanly:

* “Make directives orange”
* “Make props italic”
* “Make tag names bold”
* per theme, per workspace, shareable

**Semantic tokens are the foundation that makes your #1 customization feature actually good.**

---

## 5) “Create Collie file from JSX/TSX selection”

This is awesome, but I’d treat it as **a later-stage power feature** because:

* JSX is a big surface area (fragments, conditionals, spreads, inline handlers, ternaries, map renders, etc.)
* You’ll want the converter logic to be shared with your website tool anyway

Pragmatic path:

* Start with a converter that supports a constrained subset (common static markup + simple expressions + props inference)
* Generate a `.collie` file + a stub `props` block
* Don’t try to refactor the TSX file automatically at first (just create the file and maybe copy path to clipboard)

---

## My priority order (opinionated)

### ✅ Priority 1: Semantic tokens + customization UI (1 + 4 together)

Because:

* It unlocks your #1 “killer feature” in a clean way
* It future-proofs highlighting
* It sets you up for diagnostics and formatting improvements later

Deliverable:

* Semantic token provider for Collie
* “Customize color for X” context menu commands
* Writes to workspace/user settings (`editor.semanticTokenColorCustomizations`)

### ✅ Priority 2: Formatting (2)

Because:

* Huge perceived quality jump
* Low complexity compared to cross-file lint
* Reduces early adoption friction

Deliverable:

* Document formatter for Collie
* `Format Document` works
* Optional: format-on-save guidance

### ✅ Priority 3: In-file diagnostics (3, Level 1)

Because:

* Feels like “real language support”
* Doesn’t require TypeScript integration
* Helps people learn the syntax faster

Deliverable:

* diagnostics for props block + directive syntax + obvious structural mistakes

### ✅ Priority 4: JSX/TSX selection → Collie file (5)

Because:

* Very cool, but likely to balloon in scope
* Better once formatting exists (generated output looks good)
* Better once semantic tokens exist (generated file looks nice immediately)

### ✅ Priority 5: Cross-file props checking (3, Level 2)

Because:

* Highest complexity
* Requires deeper architecture decisions (LSP? TS service?)
* Worth it, but only when Collie usage patterns are stable
