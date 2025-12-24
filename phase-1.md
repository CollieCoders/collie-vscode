# 📘 **ID Features & Editor Intelligence — Implementation Plan**

This document defines the end-to-end implementation of Collie’s new ID-aware editor features inside the **collie-vscode** extension.
Every stage builds on the previous ones. Work must be performed **in order**.
Unless explicitly specified: **Do NOT refactor, relocate, rename, or delete files. Only edit what is required to implement the stage.**

---

# **Stage 1 — ID Directive Parsing + Semantic Highlighting**

## 🎯 Goal

The extension must fully understand ID directives at the top of `.collie` files, highlight them with semantic tokens, and store normalized + raw IDs in the AST.

## ✅ Requirements

### **1. ID Directive Forms to Support**

All of these must parse identically, case-insensitive:

```
#id homeHero
#id = homeHero
#id: homeHero
id homeHero
id = homeHero
id: homeHero
ID homeHero
iD homeHero
```

### **2. Parsing**

Update:

* `src/format/parser/ast.ts`
* `src/format/parser/parse.ts`

Add to `RootNode`:

```ts
id?: string;        // normalized id
rawId?: string;     // unmodified text after keyword
idSpan?: SourceSpan;
```

Parsing rules:

* `id` directive must appear **before any template nodes**, and **before `props` or `classes` blocks**.
* If invalid ordering: produce a parser diagnostic.
* Normalize IDs using the same logic as the compiler (strip trailing `-collie` from the value).
* Store both `rawId` and normalized `id`.

### **3. Semantic Tokens**

Update:

* `src/features/semanticTokens/legend.ts`
* `src/features/semanticTokens/tokenize.ts`

Add two token types:

```
collieIdKeyword
collieIdValue
```

Tokenization rules:

* Keyword token: the `id` / `#id` part.
* Value token: the identifier (e.g., `homeHero`).
* Must not conflict with tag, props, classes, directive tokens.

### **4. Theming**

Update:

* `package.json` → `editor.semanticTokenColorCustomizations.rules`

Add colors for both token types. Use distinct, attention-grabbing colors.

## ✔️ Acceptance Criteria

* Each valid ID directive is parsed into `RootNode.id`, `RootNode.rawId`, `RootNode.idSpan`.
* Semantic tokens correctly classify keyword/value.
* Incorrectly positioned ID directives emit diagnostics.
* Colors show visibly distinct highlighting for ID keywords + values.

---

# **Stage 2 — Workspace-Level ID Uniqueness Diagnostics**

## 🎯 Goal

Detect and surface template ID collisions across the workspace — explicit and implicit — with actionable diagnostics.

## ✅ Requirements

### **1. Build a Template ID Index**

Create or extend the language cache system to maintain:

```ts
interface TemplateIdEntry {
  id: string;                     // normalized logical ID
  rawId?: string;
  uri: Uri;
  idSpan?: SourceSpan;            // where the id directive appears (if any)
  derivedFromFilename: boolean;   // implicit id
}
```

ID derivation rules:

* Use `RootNode.id` if explicit.
* Otherwise derive from filename:

  * Strip `.collie`.
  * Also strip trailing `-collie` before normalization.

### **2. Collision Rules**

Emit **DiagnosticSeverity.Error** when:

1. Two files have the same explicit `id`.
2. One explicit id collides with another file’s derived id.
3. Two files have the same derived id (e.g., same filename).
4. Values normalize to the same id:

   * `homeHero` ↔ `homeHero-collie`.

### **3. Diagnostic Behavior**

Diagnostics appear:

* At `idSpan` if explicit.
* At the filename “basename span” if implicit.

Diagnostic message format:

```
Duplicate Collie template id "homeHero".
Also defined in:
- src/components/Hero.collie (explicit/implicit)
- src/sections/homeHero.collie (explicit/implicit)
```

### **4. Quick Fixes (Basic Only)**

Implement **minimally**:

* “Rename ID in this file…”

  * Insert a suggested placeholder (e.g., `homeHero2`) or editable value.
* “Open conflicting template(s)”

  * Opens all URIs that share this ID.

## ✔️ Acceptance Criteria

* Any duplicated or conflicting IDs produce red squiggles.
* Diagnostics clearly indicate explicit vs implicit collisions.
* Fixing the ID or filename clears the error immediately.
* Quick Fixes appear and perform actions accurately.

---

# **Stage 3 — HTML Placeholder Match Warnings**

## 🎯 Goal

Warn the user when a template has no matching HTML placeholder (`id="<id>-collie"`) anywhere in the workspace.

## ✅ Requirements

### **1. HTML Anchor Index**

Scan all `**/*.html` files and maintain:

```ts
Map<string, Set<Uri>>  // logicalId -> HTML documents containing id="<id>-collie"
```

Rules:

* Must update on save and on HTML file creation/deletion.
* Must support multiple anchors per file.

### **2. Diagnostics**

For each template ID:

* If no HTML file contains `id="<id>-collie"`:

  * Emit **DiagnosticSeverity.Warning** at the idSpan (or filename span).

Message example:

```
Template id "homeHero" has no matching HTML placeholder.
The Collie runtime looks for id="homeHero-collie" in your HTML.
This template will not render until a placeholder exists.
```

### **3. Quick Fix (Optional)**

Not required, but allowed:

* “Search workspace for `homeHero-collie`”
* “Open HTML files in workspace” (if any exist)

## ✔️ Acceptance Criteria

* Templates with no anchor produce warnings.
* Adding `<div id="homeHero-collie"></div>` clears the warning.
* Behavior is incremental and performant.
