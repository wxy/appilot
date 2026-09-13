import { registerAiHandlers } from "./handlers/ai";
import { registerActionHandlers } from "./handlers/actions";
import { registerCompetitorsHandlers } from "./handlers/competitors";
import { registerOpsHandlers } from "./handlers/ops";
import { registerOverviewHandlers } from "./handlers/overview";
import { registerProjectsHandlers } from "./handlers/projects";
import { registerReleaseHandlers } from "./handlers/release";
import { registerSchedulerHandlers } from "./handlers/scheduler";
import { registerShellHandlers } from "./handlers/shell";

/** Aggregates every IPC handler registration by domain. */
export function registerIpcHandlers() {
  registerShellHandlers();
  registerActionHandlers();
  registerSchedulerHandlers();
  registerAiHandlers();
  registerCompetitorsHandlers();
  registerOpsHandlers();
  registerOverviewHandlers();
  registerProjectsHandlers();
  registerReleaseHandlers();
}
