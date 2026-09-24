import * as Arr from "effect/Array";
import type {
  AwenProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "@awen/contracts";

function applyAwenProjectUpdate(
  projects: OrchestrationShellSnapshot["awenProjects"],
  nextProject: AwenProjectShell | undefined,
) {
  if (nextProject === undefined) return projects;
  const current = projects ?? [];
  return current.some((project) => project.id === nextProject.id)
    ? Arr.map(current, (project) => (project.id === nextProject.id ? nextProject : project))
    : Arr.append(current, nextProject);
}

/**
 * Reduce a single shell stream event into an existing snapshot, returning a new
 * snapshot with the event's changes applied. This is a pure reducer that both
 * web and mobile can use to keep their local shell snapshot in sync.
 *
 * Returns the original snapshot reference unchanged if the event is not
 * recognized (forward-compatible).
 */
export function applyShellStreamEvent(
  snapshot: OrchestrationShellSnapshot,
  event: OrchestrationShellStreamEvent,
): OrchestrationShellSnapshot {
  if (event.sequence <= snapshot.snapshotSequence) return snapshot;

  switch (event.kind) {
    case "project-upserted": {
      const projects = snapshot.projects.some((p) => p.id === event.project.id)
        ? Arr.map(snapshot.projects, (p) => (p.id === event.project.id ? event.project : p))
        : Arr.append(snapshot.projects, event.project);
      const awenProjects = applyAwenProjectUpdate(snapshot.awenProjects, event.awenProject);
      return { ...snapshot, projects, awenProjects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        awenProjects:
          event.awenProject !== undefined
            ? applyAwenProjectUpdate(snapshot.awenProjects, event.awenProject)
            : event.awenProjectId === undefined
              ? snapshot.awenProjects
              : Arr.filter(
                  snapshot.awenProjects ?? [],
                  (project) => project.id !== event.awenProjectId,
                ),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);
      const awenProjects = applyAwenProjectUpdate(snapshot.awenProjects, event.awenProject);
      return { ...snapshot, threads, awenProjects, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        awenProjects: applyAwenProjectUpdate(snapshot.awenProjects, event.awenProject),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
