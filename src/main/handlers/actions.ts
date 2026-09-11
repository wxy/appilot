import { ipcMain } from "electron";
import {
  executeRegisteredAction,
  listRegisteredActions,
  previewRegisteredAction,
  type AppActionRequest,
} from "../action-registry";
import { notifyDataChanged } from "../data-sync";
import { schedulerTick } from "../scheduler";
import { getStore } from "../store";

export function registerActionHandlers(): void {
  ipcMain.handle("actions:list", () => listRegisteredActions());

  ipcMain.handle("actions:preview", async (_event, request: AppActionRequest) =>
    previewRegisteredAction(await getStore(), request));

  ipcMain.handle("actions:execute", async (_event, request: AppActionRequest) => {
    try {
      const result = executeRegisteredAction(await getStore(), request);
      void schedulerTick();
      notifyDataChanged("projects");
      return result;
    } catch (error: any) {
      if (error?.execution) {
        return { execution: error.execution, updatedProject: null };
      }
      throw error;
    }
  });
}
