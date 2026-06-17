import * as fs from 'fs';
import * as path from 'path';
import CodeGraph from '../index';
import { getCodeGraphDir, isInitialized } from '../directory';
import type { IndexResult } from '../extraction';
import { ensureGitCheckout } from './git';
import type { ProjectRegistry } from './registry';
import type {
  AddProjectInput,
  OperationKind,
  OperationState,
  OperationTrigger,
  ProjectRecord,
  ProjectStatus,
  ProjectSummary,
  UpdateProjectScheduleInput,
} from './types';

export class ProjectService {
  private operations = new Map<string, OperationState>();
  private scheduler: ReturnType<typeof setInterval> | null = null;

  constructor(private registry: ProjectRegistry) {}

  listProjects(): ProjectSummary[] {
    return this.registry.list().map((project) => this.summarize(project));
  }

  getProject(id: string): ProjectSummary | null {
    const project = this.registry.get(id);
    return project ? this.summarize(project) : null;
  }

  addProject(input: AddProjectInput): ProjectSummary {
    const project = this.registry.add(input);
    return this.summarize(project);
  }

  removeProject(id: string): ProjectRecord | null {
    if (this.isRunning(id)) {
      throw new Error('Cannot remove a project while an operation is running');
    }
    this.operations.delete(id);
    return this.registry.remove(id);
  }

  setDefault(id: string): ProjectSummary | null {
    const project = this.registry.setDefault(id);
    return project ? this.summarize(project) : null;
  }

  updateSchedule(id: string, input: UpdateProjectScheduleInput): ProjectSummary | null {
    const project = this.registry.updateSchedule(id, input);
    return project ? this.summarize(project) : null;
  }

  startScheduler(): void {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => {
      this.runDueSchedules();
    }, 60_000);
    this.scheduler.unref?.();
    this.runDueSchedules();
  }

  stopScheduler(): void {
    if (!this.scheduler) return;
    clearInterval(this.scheduler);
    this.scheduler = null;
  }

  getOperation(projectId: string): OperationState | null {
    const operation = this.operations.get(projectId);
    return operation ? cloneOperation(operation) : null;
  }

  startOperation(projectId: string, kind: OperationKind, trigger: OperationTrigger = 'manual'): OperationState {
    const project = this.registry.get(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const existing = this.operations.get(projectId);
    if (existing?.status === 'running') {
      throw new Error(`${existing.kind} is already running for ${project.name}`);
    }

    const operation: OperationState = {
      id: `${kind}-${Date.now().toString(36)}`,
      projectId,
      kind,
      status: 'running',
      trigger,
      startedAt: new Date().toISOString(),
      logs: [],
    };
    this.operations.set(projectId, operation);
    this.runOperation(project, operation).catch((err) => {
      this.fail(operation, err instanceof Error ? err.message : String(err));
    });
    return cloneOperation(operation);
  }

  describeStatus(project: ProjectRecord): ProjectStatus {
    const exists = fs.existsSync(project.path);
    const base: ProjectStatus = {
      initialized: false,
      exists,
      projectPath: project.path,
      indexPath: getCodeGraphDir(project.path),
      lastIndexed: null,
      fileCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      dbSizeBytes: 0,
      backend: null,
      journalMode: null,
      languages: [],
      nodesByKind: {},
      pendingChanges: { added: 0, modified: 0, removed: 0 },
      reindexRecommended: false,
    };

    if (!exists && project.source.type !== 'git') {
      return { ...base, error: 'Project path no longer exists' };
    }
    if (!exists) {
      return base;
    }
    if (!isInitialized(project.path)) {
      return base;
    }

    let cg: CodeGraph | null = null;
    try {
      cg = CodeGraph.openSync(project.path);
      const stats = cg.getStats();
      const changed = cg.getChangedFiles();
      const lastIndexedMs = cg.getLastIndexedAt();
      return {
        ...base,
        initialized: true,
        lastIndexed: lastIndexedMs != null ? new Date(lastIndexedMs).toISOString() : null,
        fileCount: stats.fileCount,
        nodeCount: stats.nodeCount,
        edgeCount: stats.edgeCount,
        dbSizeBytes: stats.dbSizeBytes,
        backend: cg.getBackend(),
        journalMode: cg.getJournalMode(),
        languages: Object.entries(stats.filesByLanguage)
          .filter(([, count]) => count > 0)
          .map(([language]) => language),
        nodesByKind: stats.nodesByKind,
        pendingChanges: {
          added: changed.added.length,
          modified: changed.modified.length,
          removed: changed.removed.length,
        },
        reindexRecommended: cg.isIndexStale(),
      };
    } catch (err) {
      return {
        ...base,
        initialized: true,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (cg) {
        try { cg.close(); } catch { /* ignore close failures in status */ }
      }
    }
  }

  private summarize(project: ProjectRecord): ProjectSummary {
    const operation = this.operations.get(project.id);
    return {
      ...project,
      status: this.describeStatus(project),
      operation: operation ? cloneOperation(operation) : undefined,
      mcpPath: `/mcp/${encodeURIComponent(project.id)}`,
    };
  }

  private async runOperation(project: ProjectRecord, operation: OperationState): Promise<void> {
    this.log(operation, `Starting ${operation.kind} for ${project.name}`);
    await this.prepareSource(project, operation);
    switch (operation.kind) {
      case 'init':
        await this.initProject(project, operation);
        break;
      case 'index':
        await this.indexProject(project, operation);
        break;
      case 'sync':
        if (isInitialized(project.path)) {
          await this.syncProject(project, operation);
        } else {
          this.log(operation, 'Project is not initialized; building the initial index');
          await this.indexProject(project, operation);
        }
        break;
    }
    operation.status = 'succeeded';
    operation.finishedAt = new Date().toISOString();
    this.log(operation, `${operation.kind} completed`);
    if (operation.trigger === 'schedule') {
      this.registry.markScheduleRun(project.id, 'succeeded');
    }
  }

  private async prepareSource(project: ProjectRecord, operation: OperationState): Promise<void> {
    if (project.source.type !== 'git') return;
    await ensureGitCheckout(project, (message) => this.log(operation, message));
  }

  private async initProject(project: ProjectRecord, operation: OperationState): Promise<void> {
    if (isInitialized(project.path)) {
      this.log(operation, 'Project is already initialized');
      operation.result = this.describeStatus(project);
      return;
    }
    let cg: CodeGraph | null = null;
    try {
      cg = await CodeGraph.init(project.path, { index: false });
      this.log(operation, `Created ${path.relative(project.path, getCodeGraphDir(project.path)) || '.codegraph'}`);
      const result = await cg.indexAll({ onProgress: (progress) => this.logProgress(operation, progress) });
      operation.result = compactIndexResult(result);
      if (!result.success) {
        throw new Error('Initial indexing failed');
      }
    } finally {
      if (cg) cg.close();
    }
  }

  private async indexProject(project: ProjectRecord, operation: OperationState): Promise<void> {
    let cg: CodeGraph | null = null;
    try {
      if (!isInitialized(project.path)) {
        cg = await CodeGraph.init(project.path, { index: false });
        this.log(operation, 'Initialized project before indexing');
      } else {
        cg = await CodeGraph.open(project.path);
        cg.clear();
        this.log(operation, 'Cleared existing graph for a full rebuild');
      }
      const result = await cg.indexAll({ onProgress: (progress) => this.logProgress(operation, progress) });
      operation.result = compactIndexResult(result);
      if (!result.success) {
        throw new Error('Indexing failed');
      }
    } finally {
      if (cg) cg.close();
    }
  }

  private async syncProject(project: ProjectRecord, operation: OperationState): Promise<void> {
    if (!isInitialized(project.path)) {
      throw new Error('Project is not initialized');
    }
    let cg: CodeGraph | null = null;
    try {
      cg = await CodeGraph.open(project.path);
      const result = await cg.sync({ onProgress: (progress) => this.logProgress(operation, progress) });
      operation.result = result;
      const changed = result.filesAdded + result.filesModified + result.filesRemoved;
      this.log(operation, `Synced ${changed} changed file(s)`);
    } finally {
      if (cg) cg.close();
    }
  }

  private logProgress(
    operation: OperationState,
    progress: { phase: string; current: number; total: number; currentFile?: string },
  ): void {
    if (progress.total > 0) {
      const pct = Math.floor((progress.current / progress.total) * 100);
      if (pct % 10 === 0 || progress.current === progress.total) {
        this.log(operation, `${progress.phase}: ${progress.current}/${progress.total} (${pct}%)`);
      }
    } else if (progress.current > 0 && progress.current % 500 === 0) {
      this.log(operation, `${progress.phase}: ${progress.current} file(s)`);
    }
  }

  private fail(operation: OperationState, message: string): void {
    operation.status = 'failed';
    operation.error = message;
    operation.finishedAt = new Date().toISOString();
    this.log(operation, `Failed: ${message}`);
    if (operation.trigger === 'schedule') {
      this.registry.markScheduleRun(operation.projectId, 'failed', message);
    }
  }

  private log(operation: OperationState, message: string): void {
    const timestamp = new Date().toISOString();
    operation.logs.push(`${timestamp} ${message}`);
    if (operation.logs.length > 400) {
      operation.logs.splice(0, operation.logs.length - 400);
    }
  }

  private isRunning(projectId: string): boolean {
    return this.operations.get(projectId)?.status === 'running';
  }

  private runDueSchedules(): void {
    const now = Date.now();
    for (const project of this.registry.list()) {
      const schedule = project.syncSchedule;
      if (!schedule?.enabled) continue;
      const nextRun = schedule.nextRunAt ? Date.parse(schedule.nextRunAt) : 0;
      if (Number.isFinite(nextRun) && nextRun > now) continue;
      if (this.isRunning(project.id)) continue;
      try {
        this.startOperation(project.id, 'sync', 'schedule');
      } catch {
        // The project may have been removed or started manually between list()
        // and scheduling. The next scheduler tick will re-evaluate.
      }
    }
  }
}

function compactIndexResult(result: IndexResult): unknown {
  return {
    success: result.success,
    filesIndexed: result.filesIndexed,
    filesSkipped: result.filesSkipped,
    filesErrored: result.filesErrored,
    nodesCreated: result.nodesCreated,
    edgesCreated: result.edgesCreated,
    durationMs: result.durationMs,
    errors: result.errors.slice(0, 20),
  };
}

function cloneOperation(operation: OperationState): OperationState {
  return {
    ...operation,
    logs: [...operation.logs],
  };
}
