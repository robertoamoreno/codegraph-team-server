# CodeGraph Docker Server

This mode runs CodeGraph as a shared service instead of a per-developer local
stdio MCP server. It provides:

- a browser UI at `/` for registering mounted repositories and running
  `init`, full `index`, and `sync`
- GitLab/GitHub/generic Git remote registration for server-managed checkouts
- a persisted project registry in `CODEGRAPH_SERVER_DATA_DIR`
- one remote MCP HTTP JSON-RPC endpoint per registered project at `/mcp/:id`
- optional bearer-token protection for the admin API and MCP endpoints
- per-project scheduled sync intervals

## Run Locally

```bash
npm ci
npm run build
CODEGRAPH_ADMIN_TOKEN=dev-token \
CODEGRAPH_MCP_TOKEN=dev-token \
node dist/bin/codegraph.js server \
  --host 127.0.0.1 \
  --port 3000 \
  --projects-root /path/to/projects
```

Open `http://127.0.0.1:3000`, enter the token, add a project path under the
configured projects root, then run Index.

## Run With Docker

```bash
docker compose up --build
```

Mount repositories under `./projects`, or add Git remotes from the UI. The
container only accepts checkout/project paths inside `CODEGRAPH_PROJECTS_DIR`
(`/projects` in the image).

## Adding GitLab or GitHub Repositories

In the UI, choose **Git remote** and configure:

- Provider: GitLab, GitHub, or Generic Git
- Remote URL: SSH (`git@gitlab.internal:group/repo.git`) or HTTPS
- Branch: optional; when set, sync fast-forwards that branch
- Token env var: optional environment variable name such as `GITLAB_TOKEN`
- Checkout path: optional path under `/projects`; defaults to `_repos/<repo>-<hash>`

Secrets are not stored in the registry. The UI/API accepts only a credential
environment variable name, never the token value. HTTPS remote URLs with embedded
credentials are rejected. For HTTPS remotes, put the token in an environment
variable and enter only the variable name in the UI. GitHub projects default to
`GITHUB_TOKEN`; GitLab projects default to `GITLAB_TOKEN`. The server reads the
token from the process environment at clone/sync time and uses `GIT_ASKPASS` for
`git clone` / `git pull`.

For SSH remotes, mount deploy keys and `known_hosts` into the container, for example:

```yaml
volumes:
  - ./projects:/projects
  - ~/.ssh:/root/.ssh:ro
```

For GitLab HTTPS tokens, the default username is `oauth2`. For GitHub HTTPS
tokens, the default username is `x-access-token`. Override it in the UI when
your internal provider expects a different username.

This server currently stores registry metadata in JSON under
`CODEGRAPH_SERVER_DATA_DIR`, not in SQL. The design avoids secret-at-rest
requirements by not persisting credentials at all. If SQL-backed multi-tenant
storage is added later, stored credentials should still be avoided; if unavoidable,
they should be envelope-encrypted with a key supplied outside the database.

## Scheduled Sync

Enable scheduled sync when adding a project, or update it from the project
detail panel. The scheduler wakes once per minute and starts a sync when
`nextRunAt` is due. For Git projects, sync first updates the checkout from
`origin` and then updates the CodeGraph index. If a Git checkout is not indexed
yet, the first scheduled sync builds the initial index.

Only one operation can run per project at a time. If a manual index or sync is
already running, the scheduler skips that tick and retries on the next due
evaluation.

## MCP Client Configuration

After a project is registered, copy its endpoint from the UI. The endpoint shape
is:

```text
http://HOST:3000/mcp/PROJECT_ID
```

Use bearer auth when `CODEGRAPH_MCP_TOKEN` is set:

```json
{
  "mcpServers": {
    "codegraph-enterprise": {
      "type": "http",
      "url": "http://HOST:3000/mcp/PROJECT_ID",
      "headers": {
        "Authorization": "Bearer change-me"
      }
    }
  }
}
```

The remote endpoint is intentionally registry-bound. A tool call can omit
`projectPath` to use the endpoint project, or pass another registered project
id/name/path. Arbitrary container paths are rejected.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEGRAPH_SERVER_HOST` | `127.0.0.1` locally, `0.0.0.0` in Docker | HTTP bind host |
| `CODEGRAPH_SERVER_PORT` | `3000` | HTTP port |
| `CODEGRAPH_SERVER_DATA_DIR` | `~/.codegraph-server` locally, `/data` in Docker | Registry storage |
| `CODEGRAPH_PROJECTS_DIR` | current directory locally, `/projects` in Docker | Allowed project root |
| `CODEGRAPH_ADMIN_TOKEN` | unset | Protects UI API |
| `CODEGRAPH_MCP_TOKEN` | `CODEGRAPH_ADMIN_TOKEN` | Protects MCP endpoints |
| `CODEGRAPH_SERVER_CORS_ORIGIN` | `*` | CORS origin |
| `CODEGRAPH_SERVER_NO_WATCH` | unset | Set `1` to disable remote MCP watchers |
| `GITLAB_TOKEN`, `GITHUB_TOKEN`, etc. | unset | Optional token env vars referenced by project Git source config |
