# Changelog

## [1.2.3] - 2026-01-05

### Changed
- **Major codebase refactor**: Reorganized internal module structure for improved maintainability and scalability
  - Split large files into focused, single-responsibility modules
  - Introduced `types.ts` and `helpers/` patterns across all major features
  - Reduced main orchestration files by 50-70% on average
  - Format parser (`parse.ts`): 1486 → 500 lines (66% reduction)
  - Semantic tokenizer (`tokenize.ts`): 614 → 387 lines (37% reduction)
  - Config module (`collieConfig.ts`): 407 → 177 lines (56% reduction)
  - Template index (`templateIndex.ts`): 395 → 16 lines (96% reduction)
  - Diagnostics provider (`provider.ts`): 678 → 532 lines (21% reduction)

### Added
- **Shared utilities** for common patterns:
  - `shared/helpers/regex.ts`: Safe regex execution helpers to prevent `lastIndex` bugs
  - `shared/helpers/uri.ts`: Canonical document/URI key helpers
  - `shared/helpers/debounce.ts`: Reusable debouncing utilities with key-based management
- **Contributing documentation**: Created `CONTRIBUTING.md` with code organization guidelines, file structure patterns, and best practices
- **Compatibility shims**: Maintained backward compatibility with thin re-exports at original locations (`src/logger.ts`, `src/lang/templateIndex.ts`)

### Internal
- Established new module structure pattern:
  - `core/`: Core utilities (logger)
  - `shared/`: Cross-cutting helpers
  - Feature modules: Each with `types.ts`, `helpers.ts`, and `helpers/` subfolder when needed
- Standardized helper extraction strategy across all features
- Improved code discoverability and navigation

## [Unreleased]
- Initial repository scaffolding and MVP stage 1 setup.
- Added semantic token customization UX, cursor-aware inference, and documentation for Collie-specific token categories.
- Introduced commands for customizing, resetting, and copying Collie semantic token color snippets so users can share their highlight schemes.

### Added
- Context menu entries for the demo flow, including "Convert to Collie" and "Convert to TSX (Copy to Clipboard)".
- Menu-specific command IDs for demo narration (`collie.convertToCollie`, `collie.convertToTsxClipboard`) wired to existing conversion handlers.
- Auto-create Collie files from TSX selection with deterministic naming, PascalCase `#id` insertion, and auto-open.
- TSX selection replacement with placeholder component usage plus import injection and dedupe.
- PascalCase `#id` diagnostics with a quick fix action.
- "Fix all Collie issues" source action aggregating fixable diagnostics.
- One-time warnings for missing `collie.config.*` and missing Collie tooling packages.

### Changed
- Conversion flow now attempts to update the originating TSX document after creating the `.collie` file.
