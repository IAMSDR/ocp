/**
 * Library API for @iamsdr/ocp.
 *
 * The plugin entry (`@iamsdr/ocp`) intentionally exports only the plugin
 * definition required by OpenCode. Import reusable helpers from
 * `@iamsdr/ocp/lib` instead.
 */
export * from "./config/registry.js";
export * from "./config/auth.js";
export * from "./fetch/models.js";
export * from "./map/model.js";
export * from "./map/capabilities.js";
export * from "./map/cost.js";
export * from "./map/filters.js";
export * from "./catalog.js";
export { createLogger, defaultLogger } from "./log.js";
export type { Logger, LogLevel } from "./log.js";