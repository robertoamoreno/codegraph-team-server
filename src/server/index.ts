import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { RemoteMcpManager } from './mcp-http';
import { ProjectRegistry } from './registry';
import { ProjectService } from './service';
import { APP_CSS, APP_JS, renderIndexHtml } from './ui';

const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1024 * 1024;

export interface CodeGraphServerOptions {
  host: string;
  port: number;
  dataDir: string;
  projectsRoot: string;
  adminToken?: string;
  mcpToken?: string;
  corsOrigin: string;
  watch: boolean;
}

export interface RunningCodeGraphServer {
  server: http.Server;
  registry: ProjectRegistry;
  service: ProjectService;
  close: () => Promise<void>;
}

export function optionsFromEnv(overrides: Partial<CodeGraphServerOptions> = {}): CodeGraphServerOptions {
  const dataDir = process.env.CODEGRAPH_SERVER_DATA_DIR
    || path.join(os.homedir(), '.codegraph-server');
  const projectsRoot = process.env.CODEGRAPH_PROJECTS_DIR || process.cwd();
  const adminToken = overrides.adminToken ?? process.env.CODEGRAPH_ADMIN_TOKEN ?? undefined;
  return {
    host: overrides.host ?? process.env.CODEGRAPH_SERVER_HOST ?? '127.0.0.1',
    port: overrides.port ?? parsePort(process.env.CODEGRAPH_SERVER_PORT),
    dataDir: overrides.dataDir ?? dataDir,
    projectsRoot: overrides.projectsRoot ?? projectsRoot,
    adminToken,
    mcpToken: overrides.mcpToken ?? process.env.CODEGRAPH_MCP_TOKEN ?? adminToken,
    corsOrigin: overrides.corsOrigin ?? process.env.CODEGRAPH_SERVER_CORS_ORIGIN ?? '*',
    watch: overrides.watch ?? process.env.CODEGRAPH_SERVER_NO_WATCH !== '1',
  };
}

export async function startCodeGraphServer(
  input: Partial<CodeGraphServerOptions> = {},
): Promise<RunningCodeGraphServer> {
  const options = optionsFromEnv(input);
  const registry = new ProjectRegistry({
    dataDir: options.dataDir,
    projectsRoot: options.projectsRoot,
  });
  const service = new ProjectService(registry);
  const mcp = new RemoteMcpManager(registry, service, { watch: options.watch });
  service.startScheduler();

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, options, service, mcp);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    server,
    registry,
    service,
    close: async () => {
      service.stopScheduler();
      mcp.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CodeGraphServerOptions,
  service: ProjectService,
  mcp: RemoteMcpManager,
): Promise<void> {
  applyCors(res, options);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/') {
      sendText(res, 200, renderIndexHtml(), 'text/html; charset=utf-8', options);
      return;
    }
    if (req.method === 'GET' && pathname === '/assets/app.css') {
      sendText(res, 200, APP_CSS, 'text/css; charset=utf-8', options);
      return;
    }
    if (req.method === 'GET' && pathname === '/assets/app.js') {
      sendText(res, 200, APP_JS, 'application/javascript; charset=utf-8', options);
      return;
    }
    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true }, options);
      return;
    }
    if (pathname === '/api/config') {
      sendJson(res, 200, {
        projectsRoot: options.projectsRoot,
        adminAuthRequired: !!options.adminToken,
        mcpAuthRequired: !!options.mcpToken,
      }, options);
      return;
    }
    if (pathname.startsWith('/api/')) {
      if (!authorize(req, options.adminToken)) {
        sendUnauthorized(res, options);
        return;
      }
      await handleApi(req, res, pathname, service, options);
      return;
    }
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      if (!authorize(req, options.mcpToken)) {
        sendUnauthorized(res, options);
        return;
      }
      await handleMcp(req, res, pathname, mcp, options);
      return;
    }

    sendJson(res, 404, { error: 'Not found' }, options);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) }, options);
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  service: ProjectService,
  options: CodeGraphServerOptions,
): Promise<void> {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[1] !== 'projects') {
    sendJson(res, 404, { error: 'Unknown API route' }, options);
    return;
  }

  if (parts.length === 2) {
    if (req.method === 'GET') {
      sendJson(res, 200, { projects: service.listProjects() }, options);
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const input = body && typeof body === 'object'
        ? body as Record<string, unknown>
        : {};
      const secretField = findSecretField(input);
      if (secretField) {
        sendJson(res, 400, { error: `Do not send secret values in the UI/API payload (${secretField}); configure an environment variable and reference its name instead` }, options);
        return;
      }
      const sourceType = input.sourceType === 'git' ? 'git' : 'path';
      if (sourceType === 'path' && typeof input.path !== 'string') {
        sendJson(res, 400, { error: 'path is required for local path projects' }, options);
        return;
      }
      if (sourceType === 'git' && typeof input.remoteUrl !== 'string') {
        sendJson(res, 400, { error: 'remoteUrl is required for git projects' }, options);
        return;
      }
      try {
        const project = service.addProject({
          sourceType,
          path: typeof input.path === 'string' ? input.path : undefined,
          name: typeof input.name === 'string' ? input.name : undefined,
          provider: input.provider === 'github' || input.provider === 'gitlab' || input.provider === 'generic'
            ? input.provider
            : undefined,
          remoteUrl: typeof input.remoteUrl === 'string' ? input.remoteUrl : undefined,
          branch: typeof input.branch === 'string' ? input.branch : undefined,
          credentialEnv: typeof input.credentialEnv === 'string' ? input.credentialEnv : undefined,
          credentialUsername: typeof input.credentialUsername === 'string' ? input.credentialUsername : undefined,
          makeDefault: input.makeDefault === true,
          scheduleEnabled: input.scheduleEnabled === true,
          scheduleIntervalMinutes: typeof input.scheduleIntervalMinutes === 'number'
            ? input.scheduleIntervalMinutes
            : undefined,
        });
        sendJson(res, 201, { project }, options);
      } catch (err) {
        sendJson(res, 400, { error: errorMessage(err) }, options);
      }
      return;
    }
  }

  const projectId = parts[2];
  if (!projectId) {
    sendJson(res, 404, { error: 'Project id is required' }, options);
    return;
  }

  if (parts.length === 3) {
    if (req.method === 'GET') {
      const project = service.getProject(projectId);
      sendJson(res, project ? 200 : 404, project ? { project } : { error: 'Project not found' }, options);
      return;
    }
    if (req.method === 'DELETE') {
      const removed = service.removeProject(projectId);
      sendJson(res, removed ? 200 : 404, removed ? { project: removed } : { error: 'Project not found' }, options);
      return;
    }
  }

  const action = parts[3];
  if (!action) {
    sendJson(res, 404, { error: 'Project action is required' }, options);
    return;
  }

  if (req.method === 'POST' && (action === 'init' || action === 'index' || action === 'sync')) {
    try {
      const operation = service.startOperation(projectId, action);
      sendJson(res, 202, { operation }, options);
    } catch (err) {
      sendJson(res, messageLooksLikeConflict(err) ? 409 : 400, { error: errorMessage(err) }, options);
    }
    return;
  }

  if (req.method === 'POST' && action === 'default') {
    const project = service.setDefault(projectId);
    sendJson(res, project ? 200 : 404, project ? { project } : { error: 'Project not found' }, options);
    return;
  }

  if (req.method === 'POST' && action === 'schedule') {
    const body = await readJsonBody(req);
    const input = body && typeof body === 'object'
      ? body as { enabled?: unknown; intervalMinutes?: unknown }
      : {};
    if (typeof input.enabled !== 'boolean') {
      sendJson(res, 400, { error: 'enabled must be a boolean' }, options);
      return;
    }
    const project = service.updateSchedule(projectId, {
      enabled: input.enabled,
      intervalMinutes: typeof input.intervalMinutes === 'number'
        ? input.intervalMinutes
        : undefined,
    });
    sendJson(res, project ? 200 : 404, project ? { project } : { error: 'Project not found' }, options);
    return;
  }

  if (req.method === 'GET' && action === 'operation') {
    const operation = service.getOperation(projectId);
    sendJson(res, 200, { operation }, options);
    return;
  }

  sendJson(res, 404, { error: 'Unknown project action' }, options);
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  mcp: RemoteMcpManager,
  options: CodeGraphServerOptions,
): Promise<void> {
  if (req.method === 'GET') {
    const projectId = mcpProjectIdFromPath(pathname);
    sendJson(res, 200, {
      endpoint: pathname,
      projectId,
      transport: 'http-json-rpc',
      method: 'POST',
    }, options);
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'MCP endpoint expects POST' }, options);
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: errorMessage(err) },
    }, options);
    return;
  }

  if (Array.isArray(body)) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Batch JSON-RPC is not supported' },
    }, options);
    return;
  }

  const response = await mcp.handle(mcpProjectIdFromPath(pathname), body);
  if (!response) {
    res.writeHead(202);
    res.end();
    return;
  }
  sendJson(res, 'error' in response ? 400 : 200, response, options);
}

function mcpProjectIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return parts[1] || null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body is too large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  options: CodeGraphServerOptions,
): void {
  applyCors(res, options);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  options: CodeGraphServerOptions,
): void {
  applyCors(res, options);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function applyCors(res: ServerResponse, options: CodeGraphServerOptions): void {
  res.setHeader('Access-Control-Allow-Origin', options.corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,mcp-session-id,mcp-protocol-version');
}

function authorize(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const auth = req.headers.authorization;
  if (auth === `Bearer ${token}`) return true;
  const alt = req.headers['x-codegraph-token'];
  return alt === token;
}

function sendUnauthorized(res: ServerResponse, options: CodeGraphServerOptions): void {
  applyCors(res, options);
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'WWW-Authenticate': 'Bearer',
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

function parsePort(raw: string | undefined): number {
  const port = raw ? Number(raw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return DEFAULT_PORT;
  }
  return port;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function messageLooksLikeConflict(err: unknown): boolean {
  return errorMessage(err).includes('already running');
}

function findSecretField(input: Record<string, unknown>): string | null {
  const allowed = new Set([
    'credentialEnv',
    'credentialUsername',
    'sourceType',
    'path',
    'name',
    'provider',
    'remoteUrl',
    'branch',
    'makeDefault',
    'scheduleEnabled',
    'scheduleIntervalMinutes',
  ]);
  const secretPattern = /(token|password|secret|private.?key|deploy.?key|credential.?value|credential.?token|access.?key)/i;
  for (const key of Object.keys(input)) {
    if (allowed.has(key)) continue;
    if (secretPattern.test(key)) return key;
  }
  return null;
}
