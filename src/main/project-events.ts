import { EventEmitter } from "events";

export const projectEvents = new EventEmitter();

export function emitProjectsChanged(): void {
  projectEvents.emit("changed");
}
