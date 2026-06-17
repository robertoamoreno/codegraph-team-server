import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getCodeGraphDir, unsafeIndexRootReason } from '../directory';
import type {
  AddProjectInput,
  GitProjectSource,
  ProjectRecord,
  ProjectSyncSchedule,
  RegistryData,
  UpdateProjectScheduleInput,
} from './types';

const REGISTRY_FILE = 'projects.json';

export interface ProjectRegistryOptions {
  dataDir: string;
  projectsRoot: string;
}

export class ProjectRegistry {
  private data: RegistryData;
  readonly dataDir: string;
  readonly projectsRoot: string;
  readonly registryPath: string;

  constructor(options: ProjectRegistryOptions) {
    this.dataDir = path.resolve(options.dataDir);
    this.projectsRoot = path.resolve(options.projectsRoot);
    this.registryPath = path.join(this.dataDir, REGISTRY_FILE);

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.projectsRoot, { recursive: true });
    this.data = this.load();
  }

  list(): ProjectRecord[] {
    return this.data.projects.map((project) => ({ ...project }));
  }

  get(id: string): ProjectRecord | null {
    const project = this.data.projects.find((p) => p.id === id);
    return project ? { ...project } : null;
  }

  getDefault(): ProjectRecord | null {
    const project = this.data.projects.find((p) => p.isDefault) ?? this.data.projects[0];
    return project ? { ...project } : null;
  }

  add(input: AddProjectInput): ProjectRecord {
    const sourceType = input.sourceType ?? (input.remoteUrl ? 'git' : 'path');
    const source = sourceType === 'git'
      ? this.buildGitSource(input)
      : { type: 'path' as const };
    const projectPath = source.type === 'git'
      ? this.resolveAllowedGitCheckoutPath(input.path, source.remoteUrl, input.name)
      : this.resolveAllowedProjectPath(input.path ?? '');

    const existing = this.data.projects.find((project) =>
      project.path === projectPath ||
      (source.type === 'git' && project.source.type === 'git' && project.source.remoteUrl === source.remoteUrl)
    );
    if (existing) {
      const updated = {
        ...existing,
        name: input.name?.trim() || existing.name,
        source,
        syncSchedule: this.buildSchedule(input, existing.syncSchedule),
        updatedAt: new Date().toISOString(),
      };
      this.replace(updated);
      return { ...updated };
    }

    const now = new Date().toISOString();
    const name = input.name?.trim() || path.basename(projectPath) || 'project';
    const project: ProjectRecord = {
      id: this.uniqueId(name, projectPath),
      name,
      path: projectPath,
      source,
      syncSchedule: this.buildSchedule(input),
      createdAt: now,
      updatedAt: now,
      isDefault: input.makeDefault === true || this.data.projects.length === 0,
    };

    if (project.isDefault) {
      this.data.projects = this.data.projects.map((p) => ({ ...p, isDefault: false }));
    }
    this.data.projects.push(project);
    this.save();
    return { ...project };
  }

  remove(id: string): ProjectRecord | null {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) return null;
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    if (project.isDefault && this.data.projects[0]) {
      this.data.projects[0] = { ...this.data.projects[0], isDefault: true, updatedAt: new Date().toISOString() };
    }
    this.save();
    return { ...project };
  }

  setDefault(id: string): ProjectRecord | null {
    const found = this.data.projects.find((project) => project.id === id);
    if (!found) return null;
    const now = new Date().toISOString();
    const selected: ProjectRecord = { ...found, isDefault: true, updatedAt: now };
    this.data.projects = this.data.projects.map((project) => {
      return project.id === id
        ? selected
        : { ...project, isDefault: false };
    });
    this.save();
    return { ...selected };
  }

  updateSchedule(id: string, input: UpdateProjectScheduleInput): ProjectRecord | null {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) return null;
    const interval = normalizeInterval(input.intervalMinutes, project.syncSchedule?.intervalMinutes);
    const updated: ProjectRecord = {
      ...project,
      syncSchedule: {
        ...project.syncSchedule,
        enabled: input.enabled,
        intervalMinutes: interval,
        nextRunAt: input.enabled
          ? nextRunAt(interval, new Date())
          : project.syncSchedule?.nextRunAt,
      },
      updatedAt: new Date().toISOString(),
    };
    this.replace(updated);
    return { ...updated };
  }

  markScheduleRun(id: string, status: 'succeeded' | 'failed', error?: string): ProjectRecord | null {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project?.syncSchedule) return null;
    const now = new Date();
    const updated: ProjectRecord = {
      ...project,
      syncSchedule: {
        ...project.syncSchedule,
        lastRunAt: now.toISOString(),
        lastStatus: status,
        lastError: status === 'failed' ? error : undefined,
        nextRunAt: project.syncSchedule.enabled
          ? nextRunAt(project.syncSchedule.intervalMinutes, now)
          : project.syncSchedule.nextRunAt,
      },
      updatedAt: now.toISOString(),
    };
    this.replace(updated);
    return { ...updated };
  }

  resolveProjectRef(ref: string): ProjectRecord | null {
    const trimmed = ref.trim();
    if (!trimmed) return null;
    const direct = this.data.projects.find((p) => p.id === trimmed || p.name === trimmed);
    if (direct) return { ...direct };

    let resolved: string | null = null;
    try {
      resolved = this.resolveAllowedProjectPath(trimmed);
    } catch {
      resolved = null;
    }
    if (!resolved) return null;

    const byPath = this.data.projects.find((p) => p.path === resolved);
    return byPath ? { ...byPath } : null;
  }

  resolveAllowedProjectPath(inputPath: string): string {
    const raw = inputPath.trim();
    if (!raw) {
      throw new Error('Project path is required');
    }
    const candidate = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(this.projectsRoot, raw);

    if (!fs.existsSync(candidate)) {
      throw new Error(`Project path does not exist: ${candidate}`);
    }
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory()) {
      throw new Error(`Project path must be a directory: ${candidate}`);
    }

    const root = realpath(this.projectsRoot);
    const projectPath = realpath(candidate);
    if (!isPathWithin(root, projectPath)) {
      throw new Error(`Project path must be inside ${root}`);
    }

    const unsafe = unsafeIndexRootReason(projectPath);
    if (unsafe) {
      throw new Error(`Refusing to index ${projectPath} because it looks like ${unsafe}`);
    }
    return projectPath;
  }

  resolveAllowedGitCheckoutPath(inputPath: string | undefined, remoteUrl: string, name?: string): string {
    const baseName = name?.trim() || repoNameFromRemote(remoteUrl);
    const defaultPath = path.join('_repos', `${slugify(baseName)}-${shortHash(remoteUrl)}`);
    const raw = inputPath?.trim() || defaultPath;
    const candidate = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(this.projectsRoot, raw);
    const root = realpath(this.projectsRoot);
    const target = fs.existsSync(candidate) ? realpath(candidate) : realpathPotential(candidate);

    if (!isPathWithin(root, target)) {
      throw new Error(`Checkout path must be inside ${root}`);
    }
    if (target === root) {
      throw new Error('Checkout path cannot be the projects root');
    }

    const unsafe = unsafeIndexRootReason(target);
    if (unsafe) {
      throw new Error(`Refusing to use ${target} because it looks like ${unsafe}`);
    }
    return target;
  }

  getIndexPath(project: ProjectRecord): string {
    return getCodeGraphDir(project.path);
  }

  private load(): RegistryData {
    if (!fs.existsSync(this.registryPath)) {
      return { version: 1, projects: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf-8')) as Partial<RegistryData>;
    if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
      throw new Error(`Invalid CodeGraph server registry at ${this.registryPath}`);
    }
    return {
      version: 1,
      projects: parsed.projects.map((project) => this.normalizeLoadedProject(project)),
    };
  }

  private normalizeLoadedProject(project: ProjectRecord): ProjectRecord {
    return {
      ...project,
      source: project.source ?? { type: 'path' },
      syncSchedule: project.syncSchedule
        ? {
          enabled: !!project.syncSchedule.enabled,
          intervalMinutes: normalizeInterval(project.syncSchedule.intervalMinutes),
          nextRunAt: project.syncSchedule.nextRunAt,
          lastRunAt: project.syncSchedule.lastRunAt,
          lastStatus: project.syncSchedule.lastStatus,
          lastError: project.syncSchedule.lastError,
        }
        : undefined,
    };
  }

  private buildGitSource(input: AddProjectInput): GitProjectSource {
    const remoteUrl = input.remoteUrl?.trim();
    if (!remoteUrl) {
      throw new Error('Git remote URL is required');
    }
    if (!isAllowedGitRemote(remoteUrl)) {
      throw new Error('Git remote must be an SSH or HTTPS URL');
    }
    if (remoteUrlContainsCredentials(remoteUrl)) {
      throw new Error('Git remote URL must not contain embedded credentials; use a token environment variable instead');
    }
    const provider = input.provider ?? inferProvider(remoteUrl);
    const credentialEnv = input.credentialEnv?.trim() || defaultCredentialEnv(provider);
    validateCredentialEnv(credentialEnv);
    const credentialUsername = input.credentialUsername?.trim();
    return {
      type: 'git',
      provider,
      remoteUrl,
      branch: normalizeBranch(input.branch),
      credentialEnv: credentialEnv || undefined,
      credentialUsername: credentialUsername || undefined,
    };
  }

  private buildSchedule(input: AddProjectInput, existing?: ProjectSyncSchedule): ProjectSyncSchedule | undefined {
    const enabled = input.scheduleEnabled ?? existing?.enabled ?? false;
    const rawInterval = input.scheduleIntervalMinutes ?? existing?.intervalMinutes;
    const intervalMinutes = normalizeInterval(rawInterval);
    if (!enabled && !existing) return undefined;
    return {
      enabled,
      intervalMinutes,
      nextRunAt: enabled
        ? existing?.nextRunAt ?? nextRunAt(intervalMinutes, new Date())
        : existing?.nextRunAt,
      lastRunAt: existing?.lastRunAt,
      lastStatus: existing?.lastStatus,
      lastError: existing?.lastError,
    };
  }

  private replace(project: ProjectRecord): void {
    this.data.projects = this.data.projects.map((existing) =>
      existing.id === project.id ? project : existing
    );
    if (project.isDefault) {
      this.data.projects = this.data.projects.map((existing) =>
        existing.id === project.id ? existing : { ...existing, isDefault: false }
      );
    }
    this.save();
  }

  private save(): void {
    const tmp = `${this.registryPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
    fs.renameSync(tmp, this.registryPath);
  }

  private uniqueId(name: string, projectPath: string): string {
    const base = slugify(name || path.basename(projectPath) || 'project');
    const hash = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 8);
    let id = `${base}-${hash}`;
    let suffix = 2;
    while (this.data.projects.some((project) => project.id === id)) {
      id = `${base}-${hash}-${suffix++}`;
    }
    return id;
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

function repoNameFromRemote(remoteUrl: string): string {
  const withoutTrailing = remoteUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const lastSlash = Math.max(withoutTrailing.lastIndexOf('/'), withoutTrailing.lastIndexOf(':'));
  const name = lastSlash >= 0 ? withoutTrailing.slice(lastSlash + 1) : withoutTrailing;
  return name || 'repo';
}

function shortHash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function normalizeBranch(branch: string | undefined): string | undefined {
  const trimmed = branch?.trim();
  return trimmed || undefined;
}

function normalizeInterval(value: number | undefined, fallback = 60): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(10080, Math.floor(parsed)));
}

function nextRunAt(intervalMinutes: number, from: Date): string {
  return new Date(from.getTime() + intervalMinutes * 60_000).toISOString();
}

function isAllowedGitRemote(remoteUrl: string): boolean {
  if (/^git@[^:]+:[^ ]+$/i.test(remoteUrl)) return true;
  if (/^ssh:\/\/[^ ]+$/i.test(remoteUrl)) return true;
  if (/^https:\/\/[^ ]+$/i.test(remoteUrl)) return true;
  return false;
}

function remoteUrlContainsCredentials(remoteUrl: string): boolean {
  if (!/^https:\/\//i.test(remoteUrl)) return false;
  try {
    const parsed = new URL(remoteUrl);
    return !!parsed.username || !!parsed.password;
  } catch {
    return false;
  }
}

function validateCredentialEnv(value: string | undefined): void {
  if (!value) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('Credential environment variable must be a valid env var name, not a token value');
  }
}

function defaultCredentialEnv(provider: 'github' | 'gitlab' | 'generic'): string | undefined {
  if (provider === 'github') return 'GITHUB_TOKEN';
  if (provider === 'gitlab') return 'GITLAB_TOKEN';
  return process.env.CODEGRAPH_GIT_TOKEN ? 'CODEGRAPH_GIT_TOKEN' : undefined;
}

function inferProvider(remoteUrl: string): 'github' | 'gitlab' | 'generic' {
  const lower = remoteUrl.toLowerCase();
  if (lower.includes('github')) return 'github';
  if (lower.includes('gitlab')) return 'gitlab';
  return 'generic';
}

function realpath(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function realpathPotential(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  let current = resolved;
  const missing: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  const base = realpath(current);
  return path.join(base, ...missing);
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
