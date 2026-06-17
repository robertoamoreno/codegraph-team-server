import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRegistry } from '../src/server/registry';

let tmpRoot: string;
let projectsRoot: string;
let dataDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-server-registry-'));
  projectsRoot = path.join(tmpRoot, 'projects');
  dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(projectsRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ProjectRegistry', () => {
  it('adds projects under the configured projects root', () => {
    const repo = path.join(projectsRoot, 'service-a');
    fs.mkdirSync(repo);
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    const project = registry.add({ path: 'service-a', name: 'Service A' });

    expect(project.name).toBe('Service A');
    expect(project.path).toBe(fs.realpathSync(repo));
    expect(project.source).toEqual({ type: 'path' });
    expect(project.isDefault).toBe(true);
    expect(registry.list()).toHaveLength(1);
    expect(registry.getDefault()?.id).toBe(project.id);
  });

  it('rejects projects outside the configured projects root', () => {
    const outside = path.join(tmpRoot, 'outside');
    fs.mkdirSync(outside);
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    expect(() => registry.add({ path: outside, name: 'Outside' }))
      .toThrow(/must be inside/);
  });

  it('resolves project references by id, name, and registered path', () => {
    const repo = path.join(projectsRoot, 'service-b');
    fs.mkdirSync(repo);
    const registry = new ProjectRegistry({ dataDir, projectsRoot });
    const project = registry.add({ path: repo, name: 'Service B' });

    expect(registry.resolveProjectRef(project.id)?.id).toBe(project.id);
    expect(registry.resolveProjectRef('Service B')?.id).toBe(project.id);
    expect(registry.resolveProjectRef(repo)?.id).toBe(project.id);
  });

  it('persists projects across registry instances', () => {
    const repo = path.join(projectsRoot, 'service-c');
    fs.mkdirSync(repo);
    const registry = new ProjectRegistry({ dataDir, projectsRoot });
    const project = registry.add({ path: repo, name: 'Service C' });

    const reloaded = new ProjectRegistry({ dataDir, projectsRoot });

    expect(reloaded.get(project.id)?.path).toBe(project.path);
  });

  it('adds git projects with a managed checkout path and schedule', () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    const project = registry.add({
      sourceType: 'git',
      name: 'Internal API',
      provider: 'gitlab',
      remoteUrl: 'git@gitlab.internal:platform/api.git',
      branch: 'main',
      credentialEnv: 'GITLAB_TOKEN',
      scheduleEnabled: true,
      scheduleIntervalMinutes: 30,
    });

    expect(project.path).toContain(path.join(projectsRoot, '_repos'));
    expect(project.source).toEqual({
      type: 'git',
      provider: 'gitlab',
      remoteUrl: 'git@gitlab.internal:platform/api.git',
      branch: 'main',
      credentialEnv: 'GITLAB_TOKEN',
      credentialUsername: undefined,
    });
    expect(project.syncSchedule?.enabled).toBe(true);
    expect(project.syncSchedule?.intervalMinutes).toBe(30);
    expect(project.syncSchedule?.nextRunAt).toBeTruthy();
  });

  it('rejects unsupported git remote schemes', () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    expect(() => registry.add({
      sourceType: 'git',
      remoteUrl: 'file:///tmp/repo',
      name: 'Bad Repo',
    })).toThrow(/SSH or HTTPS/);
  });

  it('defaults github and gitlab credentials to environment variable names', () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    const github = registry.add({
      sourceType: 'git',
      remoteUrl: 'https://github.com/acme/web.git',
      name: 'Web',
    });
    const gitlab = registry.add({
      sourceType: 'git',
      remoteUrl: 'https://gitlab.internal/acme/api.git',
      name: 'API',
    });

    expect(github.source.type === 'git' && github.source.credentialEnv).toBe('GITHUB_TOKEN');
    expect(gitlab.source.type === 'git' && gitlab.source.credentialEnv).toBe('GITLAB_TOKEN');
  });

  it('rejects embedded credentials in https git remotes', () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    expect(() => registry.add({
      sourceType: 'git',
      remoteUrl: 'https://token@gitlab.internal/acme/api.git',
      name: 'Leaky Repo',
    })).toThrow(/must not contain embedded credentials/);
  });

  it('rejects credential env values that are not env var names', () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });

    expect(() => registry.add({
      sourceType: 'git',
      remoteUrl: 'https://gitlab.internal/acme/api.git',
      credentialEnv: 'glpat-token-with-dashes',
      name: 'Bad Credential Env',
    })).toThrow(/valid env var name/);
  });

  it('updates schedule metadata', () => {
    const repo = path.join(projectsRoot, 'service-d');
    fs.mkdirSync(repo);
    const registry = new ProjectRegistry({ dataDir, projectsRoot });
    const project = registry.add({ path: repo, name: 'Service D' });

    const updated = registry.updateSchedule(project.id, { enabled: true, intervalMinutes: 15 });
    const marked = registry.markScheduleRun(project.id, 'failed', 'network unavailable');

    expect(updated?.syncSchedule?.enabled).toBe(true);
    expect(updated?.syncSchedule?.intervalMinutes).toBe(15);
    expect(marked?.syncSchedule?.lastStatus).toBe('failed');
    expect(marked?.syncSchedule?.lastError).toBe('network unavailable');
  });
});
