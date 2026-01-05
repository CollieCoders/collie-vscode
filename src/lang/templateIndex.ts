// Compatibility shim: re-export from templateIndex/index.ts
export type { TemplateLocation } from './templateIndex/types';
export {
  onDidChangeTemplateIndex,
  clearTemplateIndex,
  removeTemplateEntries,
  updateTemplateIndex,
  scheduleTemplateIndexUpdate,
  getById,
  listIds,
  listByFile,
  registerTemplateIndex
} from './templateIndex/index';

// For backward compatibility, export scanWorkspaceTemplates as well
export { scanWorkspace as scanWorkspaceTemplates } from './templateIndex/index';
