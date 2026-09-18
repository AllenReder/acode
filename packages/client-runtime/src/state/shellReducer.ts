import * as Arr from "effect/Array";
import type {
  AcodeProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
} from "@t3tools/contracts";

function applyAcodeProjectUpdate(
  projects: OrchestrationShellSnapshot["acodeProjects"],
  nextProject: AcodeProjectShell | undefined,
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
      const acodeProjects = applyAcodeProjectUpdate(snapshot.acodeProjects, event.acodeProject);
      return { ...snapshot, projects, acodeProjects, snapshotSequence: event.sequence };
    }
    case "project-removed":
      return {
        ...snapshot,
        projects: Arr.filter(snapshot.projects, (p) => p.id !== event.projectId),
        acodeProjects:
          event.acodeProjectId === undefined
            ? snapshot.acodeProjects
            : Arr.filter(
                snapshot.acodeProjects ?? [],
                (project) => project.id !== event.acodeProjectId,
              ),
        snapshotSequence: event.sequence,
      };
    case "thread-upserted": {
      const threads = snapshot.threads.some((t) => t.id === event.thread.id)
        ? Arr.map(snapshot.threads, (t) => (t.id === event.thread.id ? event.thread : t))
        : Arr.append(snapshot.threads, event.thread);
      const acodeProjects = applyAcodeProjectUpdate(snapshot.acodeProjects, event.acodeProject);
      return { ...snapshot, threads, acodeProjects, snapshotSequence: event.sequence };
    }
    case "thread-removed":
      return {
        ...snapshot,
        threads: Arr.filter(snapshot.threads, (t) => t.id !== event.threadId),
        acodeProjects: applyAcodeProjectUpdate(snapshot.acodeProjects, event.acodeProject),
        snapshotSequence: event.sequence,
      };
    default:
      return snapshot;
  }
}
