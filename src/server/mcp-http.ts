import { isInitialized } from '../directory';
import { MCPEngine } from '../mcp/engine';
import { SERVER_INFO, PROTOCOL_VERSION } from '../mcp/session';
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_UNINDEXED } from '../mcp/server-instructions';
import { ErrorCodes, type JsonRpcResponse } from '../mcp/transport';
import { tools as codegraphTools, type ToolDefinition, type ToolResult } from '../mcp/tools';
import { getTelemetry } from '../telemetry';
import type { ProjectRegistry } from './registry';
import type { ProjectService } from './service';
import type { OperationState, ProjectRecord, ProjectStatus } from './types';

interface JsonRpcIncoming {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type ProjectListing = ProjectRecord & {
  mcpPath: string;
  status?: ProjectStatus;
  operation?: OperationState;
};

export interface RemoteMcpManagerOptions {
  watch?: boolean;
}

export class RemoteMcpManager {
  private engines = new Map<string, MCPEngine>();
  private watch: boolean;
  private service: ProjectService | null;

  constructor(
    private registry: ProjectRegistry,
    serviceOrOptions: ProjectService | RemoteMcpManagerOptions | null = null,
    options: RemoteMcpManagerOptions = {},
  ) {
    if (isProjectService(serviceOrOptions)) {
      this.service = serviceOrOptions;
    } else {
      this.service = null;
      options = serviceOrOptions ?? {};
    }
    this.watch = options.watch ?? true;
  }

  stop(): void {
    for (const engine of this.engines.values()) {
      engine.stop();
    }
    this.engines.clear();
  }

  async handle(projectId: string | null, payload: unknown): Promise<JsonRpcResponse | null> {
    if (!isJsonRpcIncoming(payload)) {
      return this.error(null, ErrorCodes.InvalidRequest, 'Invalid JSON-RPC request');
    }

    const id = typeof payload.id === 'string' || typeof payload.id === 'number'
      ? payload.id
      : null;
    const isNotification = !('id' in payload);
    const method = payload.method;

    if (typeof method !== 'string') {
      return this.error(id, ErrorCodes.InvalidRequest, 'Missing JSON-RPC method');
    }

    const project = this.resolveTargetProject(projectId);
    if (!project && projectId) {
      return this.error(id, ErrorCodes.InvalidParams, 'No registered CodeGraph project matches this MCP endpoint');
    }

    switch (method) {
      case 'initialize':
        return isNotification ? null : this.result(id, this.initializeResult(project));
      case 'initialized':
      case 'notifications/initialized':
        return null;
      case 'ping':
        return isNotification ? null : this.result(id, {});
      case 'tools/list':
        return isNotification ? null : this.result(id, await this.listTools(project));
      case 'tools/call':
        return isNotification ? null : this.result(id, await this.callTool(project, payload.params));
      case 'resources/list':
        return isNotification ? null : this.result(id, { resources: [] });
      case 'resources/templates/list':
        return isNotification ? null : this.result(id, { resourceTemplates: [] });
      case 'prompts/list':
        return isNotification ? null : this.result(id, { prompts: [] });
      default:
        return isNotification ? null : this.error(id, ErrorCodes.MethodNotFound, `Method not found: ${method}`);
    }
  }

  private initializeResult(project: ProjectRecord | null): unknown {
    const indexed = project ? isInitialized(project.path) : false;
    if (project && indexed) {
      void this.getEngine(project).ensureInitialized(project.path);
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: project && indexed
        ? SERVER_INSTRUCTIONS
        : `${SERVER_INSTRUCTIONS_UNINDEXED}\n\nUse codegraph_projects to list projects registered on this shared CodeGraph server.`,
    };
  }

  private async listTools(project: ProjectRecord | null): Promise<{ tools: ToolDefinition[] }> {
    const serverTools = this.getServerTools();
    if (!project) {
      return { tools: serverTools };
    }

    const engine = this.getEngine(project);
    await engine.ensureInitialized(project.path);
    const statusTool = this.getCodeGraphTool('codegraph_status');
    if (!engine.hasDefaultCodeGraph()) {
      return {
        tools: this.uniqueTools([
          ...serverTools,
          ...(statusTool ? this.decorateTools([statusTool]) : []),
        ]),
      };
    }
    return {
      tools: this.uniqueTools([
        ...serverTools,
        ...this.decorateTools(engine.getToolHandler().getTools()),
      ]),
    };
  }

  private async callTool(project: ProjectRecord | null, params: unknown): Promise<ToolResult> {
    if (!params || typeof params !== 'object') {
      return this.toolError('Missing tool call params');
    }
    const raw = params as { name?: unknown; arguments?: unknown };
    if (typeof raw.name !== 'string' || !raw.name) {
      return this.toolError('Missing tool name');
    }
    if (raw.name === 'codegraph_projects') {
      return this.callProjectsTool(raw.arguments);
    }
    if (!project) {
      return this.toolError('No default project is registered on this CodeGraph server. Use codegraph_projects to list available projects.');
    }

    const engine = this.getEngine(project);
    await engine.ensureInitialized(project.path);
    const args = this.normalizeToolArguments(raw.arguments);
    if (isToolResult(args)) {
      return args;
    }

    const result = await engine.getToolHandler().execute(raw.name, args);
    try {
      getTelemetry().recordUsage('mcp_tool', raw.name, !result.isError, { name: 'codegraph-server-http' });
    } catch {
      /* telemetry must not affect MCP responses */
    }
    return result;
  }

  private normalizeToolArguments(value: unknown): Record<string, unknown> | ToolResult {
    const args = value && typeof value === 'object'
      ? { ...(value as Record<string, unknown>) }
      : {};
    const projectPath = args.projectPath;
    if (projectPath === undefined || projectPath === null) {
      return args;
    }
    if (typeof projectPath !== 'string') {
      return this.toolError('projectPath must be a registered project id, name, or path');
    }
    const project = this.registry.resolveProjectRef(projectPath);
    if (!project) {
      return this.toolError(`Project is not registered on this CodeGraph server: ${projectPath}`);
    }
    args.projectPath = project.path;
    return args;
  }

  private decorateTools(tools: ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => {
      const projectPath = tool.inputSchema.properties.projectPath;
      if (!projectPath) return tool;
      return {
        ...tool,
        inputSchema: {
          ...tool.inputSchema,
          properties: {
            ...tool.inputSchema.properties,
            projectPath: {
              ...projectPath,
              description: 'Optional registered project id, name, or path on this CodeGraph server. Omit it to use this endpoint project.',
            },
          },
        },
      };
    });
  }

  private getServerTools(): ToolDefinition[] {
    return this.isToolAllowedByEnv('codegraph_projects') ? [CODEGRAPH_PROJECTS_TOOL] : [];
  }

  private getCodeGraphTool(name: string): ToolDefinition | null {
    if (!this.isToolAllowedByEnv(name)) return null;
    return codegraphTools.find((tool) => tool.name === name) ?? null;
  }

  private isToolAllowedByEnv(name: string): boolean {
    const raw = process.env.CODEGRAPH_MCP_TOOLS;
    if (!raw || !raw.trim()) return true;
    const allow = new Set(raw.split(',').map((value) => shortToolName(value)).filter(Boolean));
    return allow.has(shortToolName(name));
  }

  private uniqueTools(tools: ToolDefinition[]): ToolDefinition[] {
    const seen = new Set<string>();
    return tools.filter((tool) => {
      if (seen.has(tool.name)) return false;
      seen.add(tool.name);
      return true;
    });
  }

  private callProjectsTool(value: unknown): ToolResult {
    if (!this.isToolAllowedByEnv('codegraph_projects')) {
      return this.toolError('Tool codegraph_projects is disabled via CODEGRAPH_MCP_TOOLS');
    }

    const args = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    if (query.length > 10_000) {
      return this.toolError('query must be 10000 characters or fewer');
    }
    const onlyIndexed = args.onlyIndexed === true;
    const includeStatus = args.includeStatus !== false || onlyIndexed;
    const projects = includeStatus && this.service
      ? this.service.listProjects()
      : this.registry.list().map(projectToListingWithoutStatus);

    const filtered = projects
      .filter((project) => !onlyIndexed || project.status?.initialized === true)
      .filter((project) => !query || projectMatchesQuery(project, query))
      .map((project) => serializeProjectForMcp(project, includeStatus));

    const result = {
      count: filtered.length,
      projects: filtered,
      usage: {
        projectPath: 'Use a project id or name from this list as projectPath on codegraph_search, codegraph_node, codegraph_explore, or codegraph_status.',
        endpoint: 'Use mcpPath to connect directly to a single project endpoint.',
      },
    };

    try {
      getTelemetry().recordUsage('mcp_tool', 'codegraph_projects', true, { name: 'codegraph-server-http' });
    } catch {
      /* telemetry must not affect MCP responses */
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  private getEngine(project: ProjectRecord): MCPEngine {
    let engine = this.engines.get(project.id);
    if (!engine) {
      engine = new MCPEngine({ watch: this.watch });
      engine.setProjectPathHint(project.path);
      this.engines.set(project.id, engine);
    }
    return engine;
  }

  private resolveTargetProject(projectId: string | null): ProjectRecord | null {
    if (!projectId) return this.registry.getDefault();
    return this.registry.get(projectId);
  }

  private result(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
  }

  private toolError(message: string): ToolResult {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
}

const CODEGRAPH_PROJECTS_TOOL: ToolDefinition = {
  name: 'codegraph_projects',
  description: 'List projects registered on this shared CodeGraph server. Use a returned id or name as projectPath on other CodeGraph tools, or connect directly to the returned mcpPath.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional case-insensitive filter over project id, name, provider, remote URL, or branch.',
      },
      includeStatus: {
        type: 'boolean',
        description: 'Include index health and freshness metadata for each project (default: true).',
        default: true,
      },
      onlyIndexed: {
        type: 'boolean',
        description: 'Return only projects with an initialized CodeGraph index (default: false).',
        default: false,
      },
    },
  },
};

function isProjectService(value: ProjectService | RemoteMcpManagerOptions | null): value is ProjectService {
  return !!value && typeof value === 'object' && 'listProjects' in value && 'getProject' in value;
}

function shortToolName(name: string): string {
  return name.trim().replace(/^codegraph_/, '');
}

function projectToListingWithoutStatus(project: ProjectRecord): ProjectListing {
  return {
    ...project,
    mcpPath: `/mcp/${encodeURIComponent(project.id)}`,
  };
}

function projectMatchesQuery(project: ProjectListing, query: string): boolean {
  const source = project.source.type === 'git'
    ? [project.source.provider, project.source.remoteUrl, project.source.branch ?? '']
    : [project.source.type];
  return [
    project.id,
    project.name,
    ...source,
  ].some((value) => value.toLowerCase().includes(query));
}

function serializeProjectForMcp(project: ProjectListing, includeStatus: boolean): Record<string, unknown> {
  const output: Record<string, unknown> = {
    id: project.id,
    name: project.name,
    projectPathRef: project.id,
    mcpPath: project.mcpPath,
    isDefault: project.isDefault === true,
    source: project.source.type === 'git'
      ? {
        type: 'git',
        provider: project.source.provider,
        remoteUrl: project.source.remoteUrl,
        branch: project.source.branch,
      }
      : { type: 'path' },
    syncSchedule: project.syncSchedule
      ? {
        enabled: project.syncSchedule.enabled,
        intervalMinutes: project.syncSchedule.intervalMinutes,
        nextRunAt: project.syncSchedule.nextRunAt,
        lastRunAt: project.syncSchedule.lastRunAt,
        lastStatus: project.syncSchedule.lastStatus,
        lastError: project.syncSchedule.lastError,
      }
      : undefined,
    operation: project.operation ? serializeOperation(project.operation) : undefined,
  };

  if (includeStatus && project.status) {
    output.status = {
      initialized: project.status.initialized,
      exists: project.status.exists,
      lastIndexed: project.status.lastIndexed,
      fileCount: project.status.fileCount,
      nodeCount: project.status.nodeCount,
      edgeCount: project.status.edgeCount,
      dbSizeBytes: project.status.dbSizeBytes,
      backend: project.status.backend,
      journalMode: project.status.journalMode,
      languages: project.status.languages,
      nodesByKind: project.status.nodesByKind,
      pendingChanges: project.status.pendingChanges,
      reindexRecommended: project.status.reindexRecommended,
      error: project.status.error,
    };
  }

  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined));
}

function serializeOperation(operation: OperationState): Record<string, unknown> {
  return Object.fromEntries(Object.entries({
    kind: operation.kind,
    status: operation.status,
    trigger: operation.trigger,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    error: operation.error,
  }).filter(([, value]) => value !== undefined));
}

function isJsonRpcIncoming(value: unknown): value is JsonRpcIncoming {
  return !!value && typeof value === 'object' && (value as JsonRpcIncoming).jsonrpc === '2.0';
}

function isToolResult(value: unknown): value is ToolResult {
  return !!value && typeof value === 'object' && Array.isArray((value as ToolResult).content);
}
