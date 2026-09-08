import type { UpdateService } from "../update-service";
import type { RegisterHandler } from "./types";

export interface UpdateHandlerDependencies {
  register: RegisterHandler;
  update: UpdateService;
}

export function registerUpdateHandlers({ register, update }: UpdateHandlerDependencies) {
  register("getUpdateStatus", () => update.status());
  register("checkForUpdates", () => update.check());
  register("installUpdate", (password) => update.install(password));
  register("saveUpdateSettings", (input) => update.saveSettings(input));
}
