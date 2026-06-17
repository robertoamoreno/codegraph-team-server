import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteMcpManager } from '../src/server/mcp-http';
import { ProjectRegistry } from '../src/server/registry';
import { ProjectService } from '../src/server/service';

let tmpRoot: string;
let projectsRoot: string;
let dataDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-server-mcp-'));
  projectsRoot = path.join(tmpRoot, 'projects');
  dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(projectsRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('RemoteMcpManager server tools', () => {
  it('lists project discovery and status tools for an unindexed project endpoint', async () => {
    const repo = path.join(projectsRoot, 'service-a');
    fs.mkdirSync(repo);
    const registry = new ProjectRegistry({ dataDir, projectsRoot });
    const project = registry.add({ path: repo, name: 'Service A' });
    const service = new ProjectService(registry);
    const mcp = new RemoteMcpManager(registry, service, { watch: false });

    const response = await mcp.handle(project.id, rpc(1, 'tools/list'));
    const names = ((response as any).result.tools as Array<{ name: string }>).map((tool) => tool.name).sort();

    expect(names).toContain('codegraph_projects');
    expect(names).toContain('codegraph_status');
    expect(names).not.toContain('codegraph_search');
  });

  it('lists project discovery at the server endpoint even when no default project exists', async () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });
    const service = new ProjectService(registry);
    const mcp = new RemoteMcpManager(registry, service, { watch: false });

    const response = await mcp.handle(null, rpc(1, 'tools/list'));
    const names = ((response as any).result.tools as Array<{ name: string }>).map((tool) => tool.name);

    expect(names).toEqual(['codegraph_projects']);
  });

  it('returns sanitized project discovery metadata', async () => {
    const registry = new ProjectRegistry({ dataDir, projectsRoot });
    const project = registry.add({
      sourceType: 'git',
      name: 'CRM',
      provider: 'gitlab',
      remoteUrl: 'https://gitlab.internal/apps/crm.git',
      branch: 'main',
      credentialEnv: 'GITLAB_TOKEN',
      scheduleEnabled: true,
      scheduleIntervalMinutes: 30,
    });
    const service = new ProjectService(registry);
    const mcp = new RemoteMcpManager(registry, service, { watch: false });

    const response = await mcp.handle(project.id, rpc(1, 'tools/call', {
      name: 'codegraph_projects',
      arguments: { query: 'crm' },
    }));
    const text = (response as any).result.content[0].text as string;
    const payload = JSON.parse(text);

    expect(payload.count).toBe(1);
    expect(payload.projects[0]).toMatchObject({
      id: project.id,
      name: 'CRM',
      projectPathRef: project.id,
      mcpPath: `/mcp/${encodeURIComponent(project.id)}`,
      source: {
        type: 'git',
        provider: 'gitlab',
        remoteUrl: 'https://gitlab.internal/apps/crm.git',
        branch: 'main',
      },
      status: {
        initialized: false,
        exists: false,
      },
      syncSchedule: {
        enabled: true,
        intervalMinutes: 30,
      },
    });
    expect(payload.projects[0]).not.toHaveProperty('path');
    expect(payload.projects[0].source).not.toHaveProperty('credentialEnv');
  });
});

function rpc(id: number, method: string, params?: unknown): Record<string, unknown> {
  return params === undefined
    ? { jsonrpc: '2.0', id, method }
    : { jsonrpc: '2.0', id, method, params };
}
