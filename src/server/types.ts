export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  source: ProjectSource;
  syncSchedule?: ProjectSyncSchedule;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export type ProjectSource = PathProjectSource | GitProjectSource;

export interface PathProjectSource {
  type: 'path';
}

export type GitProvider = 'github' | 'gitlab' | 'generic';

export interface GitProjectSource {
  type: 'git';
  provider: GitProvider;
  remoteUrl: string;
  branch?: string;
  credentialEnv?: string;
  credentialUsername?: string;
}

export interface ProjectSyncSchedule {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: 'succeeded' | 'failed';
  lastError?: string;
}

export interface AddProjectInput {
  sourceType?: 'path' | 'git';
  name?: string;
  path?: string;
  provider?: GitProvider;
  remoteUrl?: string;
  branch?: string;
  credentialEnv?: string;
  credentialUsername?: string;
  makeDefault?: boolean;
  scheduleEnabled?: boolean;
  scheduleIntervalMinutes?: number;
}

export interface UpdateProjectScheduleInput {
  enabled: boolean;
  intervalMinutes?: number;
}

export interface RegistryData {
  version: 1;
  projects: ProjectRecord[];
}

export interface ProjectStatus {
  initialized: boolean;
  exists: boolean;
  projectPath: string;
  indexPath: string;
  lastIndexed: string | null;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  dbSizeBytes: number;
  backend: string | null;
  journalMode: string | null;
  languages: string[];
  nodesByKind: Record<string, number>;
  pendingChanges: {
    added: number;
    modified: number;
    removed: number;
  };
  reindexRecommended: boolean;
  error?: string;
}

export interface ProjectSummary extends ProjectRecord {
  status: ProjectStatus;
  operation?: OperationState;
  mcpPath: string;
}

export type OperationKind = 'init' | 'index' | 'sync';
export type OperationStatus = 'running' | 'succeeded' | 'failed';
export type OperationTrigger = 'manual' | 'schedule';

export interface OperationState {
  id: string;
  projectId: string;
  kind: OperationKind;
  status: OperationStatus;
  trigger: OperationTrigger;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  result?: unknown;
  error?: string;
}
