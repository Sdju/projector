export { createAcpBackend } from "./acp-backend.ts";
export { registerAcpProgram, type AcpProgram } from "./acp-programs.ts";
export {
  createPlainDialect,
  extendPlainDialect,
  inputOf,
  isOver,
  shorten,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "./acp-dialect.ts";
