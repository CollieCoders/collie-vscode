# Collie VS Code Demo Checklist (MVP)

> **Purpose**
> Manual verification checklist for the Collie VS Code extension demo flow.
> This document is acceptance criteria for future stages. It also notes what is *not yet wired* (e.g., right-click menus) so demo expectations stay realistic.

---

## A. Preconditions (One-Time Setup)

### A1. Workspace + extension

* ✅ Open the Vite demo project folder in VS Code
* ✅ Collie extension is installed/enabled
* ✅ Extension activates for `.collie` files (syntax highlighting should appear)

### A2. Dev server (integration)

* ✅ `npm run dev` is running in the demo project
* ✅ App loads in browser

---

## B. Command Registration Sanity (Truth Source: `package.json`)

These commands **must exist** in the Command Palette:

* ✅ `collie.convertTsxSelectionToCollie`
  Title: **“Collie: Convert JSX/TSX Selection to Collie”**
* ✅ `collie.copyAsTsx`
  Title: **“Collie: Copy as TSX”**
* ✅ `collie.copyAsJsx`
  Title: **“Collie: Copy as JSX”**

**Activation events expected:**

* `onLanguage:collie`
* `onCommand:<the three commands above>`

---

## C. Context Menu Wiring (Stage 1 target)

### C1. Current status (today)

* 🚩 Right-click **does not** currently expose demo commands.
  `menus.editor/context` currently includes only:

  * “Collie: Customize Token Color”
  * “Collie: Reset Token Customization”

### C2. Stage 1 acceptance criteria (future)

After Stage 1, verify:

* In TSX with a non-empty selection:

  * ✅ Right click shows **Convert to Collie**

    * (mapped to `collie.convertTsxSelectionToCollie`)
* In `.collie` editor:

  * ✅ Right click shows **Convert to TSX (Copy to Clipboard)**

    * (mapped to `collie.copyAsTsx`)
  * (Optional) ✅ shows **Convert to JSX (Copy to Clipboard)**

---

## D. Convert Selection → Collie (Stage 2–3 target)

### D1. Current expectation (today)

Until Stage 2–3 are implemented, the command may:

* convert selection and **copy** Collie text, and/or
* prompt to **save** a `.collie` file
  …but may **not** modify the TSX file in-place yet.

Record actual behavior during development.

### D2. Stage 2 acceptance criteria (file creation)

In a TSX file (`.tsx` or `.jsx`):

1. Select a block of JSX
2. Run command from Command Palette:
   **“Collie: Convert JSX/TSX Selection to Collie”**

Verify:

* ✅ `.collie` file is created in the **same folder** as the TSX file by default
* ✅ Deterministic naming & conflict handling
* ✅ New file begins with:

  * `#id <PascalCaseName>`

### D3. Stage 3 acceptance criteria (TSX replacement + import injection)

After conversion, verify the TSX file:

* ✅ Selected JSX is replaced with placeholder usage (e.g. `<MyComponent />`)
* ✅ Import inserted at bottom of import block
* ✅ No duplicate imports
* ✅ File still compiles

---

## E. Live Dev Loop Confirmation (Integration)

With dev server running:

* Edit visible text in the `.collie` file
* Save

Verify:

* ✅ Browser updates quickly (HMR or full reload acceptable)
* 📝 Note whether it’s HMR vs full reload

---

## F. Diagnostics + Quick Fix (Stage 4+ target)

In a `.collie` file:

```collie
#id my-component
```

Verify:

* ✅ Inline diagnostic squiggle appears
* ✅ Diagnostic message explains PascalCase requirement
* ✅ Quick fix exists to convert to PascalCase
* ✅ After applying quick fix, diagnostic disappears

---

## G. Fix All (Stage 5+ target)

Verify one of:

* ✅ “Fix all Collie issues” code action exists and works
  **OR**
* ✅ “Format Document” normalizes fixable issues (if you intentionally choose format-as-fix-all)

---

## H. Formatting (Formatter exists today)

In a `.collie` file:

* Introduce messy indentation/spacing
* Run **Format Document**

Verify:

* ✅ stable formatting output
* ✅ formatting twice yields identical output
* ✅ no syntax corruption

---

## I. Convert to TSX Fallback (Stage 4+ / Stage 9 target)

In a `.collie` file:

* Run **“Collie: Copy as TSX”**
* Paste into a TSX file

Verify:

* ✅ clipboard contains TSX
* ✅ TSX compiles for the simple demo snippet

---

## J. Missing Config / Tooling UX (Stage 6 target)

Verify:

* ✅ missing config produces one-time actionable warning (no spam)
* ✅ missing packages/tooling produces one-time actionable warning (optional)

---

## Implementation Pointers (for reference)

* `package.json` (commands, activation events, menus)
* conversion command implementation:

  * `src/features/conversion/*` (expected)
* diagnostics providers:

  * `src/features/diagnostics/*` (expected)
* formatting providers:

  * `src/features/formatting/*` and `src/format/*` (expected)

---

## Regression Gate (After ANY change)

* ✅ Command palette commands still exist and execute
* ✅ Formatting still works
* ✅ Diagnostics still show inline (where implemented)
* ✅ No repeated/spammy warnings
* ✅ Extension still builds (`pnpm build` or repo build command)
* ✅ `tsc --noEmit` passes (`pnpm lint`)

---

## Final notes / recommendations

* For demo reliability, keep the demo selection simple:

  * mostly static JSX
  * minimal props
  * avoid expressions, loops, inline functions
