import { registerAiHandlers } from "./handlers/ai";
import { registerCompetitorsHandlers } from "./handlers/competitors";
import { registerOpsHandlers } from "./handlers/ops";
import { registerProjectsHandlers } from "./handlers/projects";
import { registerReleaseHandlers } from "./handlers/release";
import { registerSchedulerHandlers } from "./handlers/scheduler";
import { registerShellHandlers } from "./handlers/shell";

/** Aggregates every IPC handler registration by domain. */
export function registerIpcHandlers() {
  registerShellHandlers();
  registerSchedulerHandlers();
  registerAiHandlers();
  registerCompetitorsHandlers();
  registerOpsHandlers();
  registerProjectsHandlers();
  registerReleaseHandlers();
}
