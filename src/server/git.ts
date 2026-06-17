import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type { GitProjectSource, ProjectRecord } from './types';

export type OperationLogger = (message: string) => void;

export async function ensureGitCheckout(project: ProjectRecord, log: OperationLogger): Promise<void> {
  if (project.source.type !== 'git') return;

  const source = project.source;
  if (!fs.existsSync(project.path) || isEmptyDirectory(project.path)) {
    await cloneRepository(project, source, log);
    return;
  }

  if (!fs.existsSync(path.join(project.path, '.git'))) {
    throw new Error(`Checkout path exists but is not a git repository: ${project.path}`);
  }

  const currentRemote = await runGit(['remote', 'get-url', 'origin'], {
    cwd: project.path,
    source,
    log,
    quiet: true,
  });
  if (currentRemote.trim() !== source.remoteUrl) {
    throw new Error(
      `Existing checkout remote does not match registry source. Expected ${redactUrl(source.remoteUrl)}, found ${redactUrl(currentRemote.trim())}`
    );
  }

  log(`Fetching ${redactUrl(source.remoteUrl)}`);
  if (source.branch) {
    await runGit(['fetch', '--prune', 'origin', source.branch], { cwd: project.path, source, log });
    const checkoutArgs = await branchExists(project.path, source.branch, source, log)
      ? ['checkout', source.branch]
      : ['checkout', '-b', source.branch, '--track', `origin/${source.branch}`];
    await runGit(checkoutArgs, { cwd: project.path, source, log });
    await runGit(['pull', '--ff-only', 'origin', source.branch], { cwd: project.path, source, log });
  } else {
    await runGit(['pull', '--ff-only'], { cwd: project.path, source, log });
  }
}

async function cloneRepository(
  project: ProjectRecord,
  source: GitProjectSource,
  log: OperationLogger,
): Promise<void> {
  fs.mkdirSync(path.dirname(project.path), { recursive: true });
  if (fs.existsSync(project.path) && !isEmptyDirectory(project.path)) {
    throw new Error(`Checkout path is not empty: ${project.path}`);
  }

  log(`Cloning ${redactUrl(source.remoteUrl)}`);
  const args = ['clone', '--depth', '1'];
  if (source.branch) {
    args.push('--branch', source.branch, '--single-branch');
  }
  args.push(source.remoteUrl, project.path);
  await runGit(args, { cwd: path.dirname(project.path), source, log });
}

async function branchExists(
  cwd: string,
  branch: string,
  source: GitProjectSource,
  log: OperationLogger,
): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', branch], { cwd, source, log, quiet: true });
    return true;
  } catch {
    return false;
  }
}

interface RunGitOptions {
  cwd: string;
  source: GitProjectSource;
  log: OperationLogger;
  quiet?: boolean;
}

async function runGit(args: string[], options: RunGitOptions): Promise<string> {
  return withGitAuth(options.source, async (env) => {
    return new Promise<string>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', reject);
      child.on('close', (code) => {
        const output = [stdout, stderr].join('\n').trim();
        if (!options.quiet && output) {
          for (const line of compactOutput(output)) {
            options.log(redactUrl(line));
          }
        }
        if (code === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`git ${args[0] ?? 'command'} failed with exit code ${code}: ${redactUrl(output)}`));
      });
    });
  });
}

async function withGitAuth<T>(
  source: GitProjectSource,
  run: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const token = source.credentialEnv ? process.env[source.credentialEnv] : undefined;
  if (!source.credentialEnv || !token) {
    return run({ ...process.env, GIT_TERMINAL_PROMPT: '0' });
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-git-askpass-'));
  const askpassPath = path.join(dir, 'askpass.sh');
  const username = source.credentialUsername || defaultUsername(source.provider);
  fs.writeFileSync(
    askpassPath,
    '#!/usr/bin/env sh\n' +
    'case "$1" in\n' +
    '*Username*) printf "%s\\n" "$CODEGRAPH_GIT_USERNAME" ;;\n' +
    '*) printf "%s\\n" "$CODEGRAPH_GIT_TOKEN" ;;\n' +
    'esac\n',
    { mode: 0o700 },
  );

  try {
    return await run({
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: askpassPath,
      CODEGRAPH_GIT_USERNAME: username,
      CODEGRAPH_GIT_TOKEN: token,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function defaultUsername(provider: GitProjectSource['provider']): string {
  if (provider === 'github') return 'x-access-token';
  if (provider === 'gitlab') return 'oauth2';
  return 'git';
}

function isEmptyDirectory(targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) return true;
  return fs.statSync(targetPath).isDirectory() && fs.readdirSync(targetPath).length === 0;
}

function compactOutput(output: string): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - 20));
}

function redactUrl(value: string): string {
  return value.replace(/(https?:\/\/)([^/@\s]+)@/g, '$1[redacted]@');
}
