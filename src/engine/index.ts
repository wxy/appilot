// @appilot/engine — Core engine logic (pure TypeScript, zero Electron/React dependency)
export const ENGINE_VERSION = "0.1.0";

// Database
export { createDatabase, getDatabase, closeDatabase } from "./database/index.js";
export * as schema from "./database/schema.js";

// AI (placeholder — Task 0.5+)
export {};
