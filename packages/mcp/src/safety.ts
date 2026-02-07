import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

export type McpSafetyOptions = {
  cwd: string;
  allowedRoots: string[];
};

export function parseAllowedRootsFromEnv(
  env: Record<string, string | undefined>,
  cwd: string
): string[] {
  const raw =
    env['SCHECK_MCP_ALLOWED_ROOTS'] ??
    env['MCP_ALLOWED_ROOTS'] ??
    env['SCHECK_ALLOWED_ROOTS'];

  const roots = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(cwd, p));

  if (roots.length > 0) return roots;

  const gitRoot = getGitRoot(cwd);
  if (gitRoot) return [gitRoot];

  throw new Error(
    'Refusing to scan because no allowed roots are configured and no git repository was detected. ' +
      'Run scheck-mcp from inside a git repo, or set SCHECK_MCP_ALLOWED_ROOTS (or MCP_ALLOWED_ROOTS).'
  );
}

function getGitRoot(cwd: string): string | null {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function isWithinRoot(candidatePath: string, root: string): boolean {
  const relative = path.relative(root, candidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function resolveAndValidateTargetPath(
  requestedPath: string | undefined,
  options: McpSafetyOptions
): string {
  const { cwd, allowedRoots } = options;
  const input = (requestedPath && requestedPath.trim().length > 0)
    ? requestedPath
    : cwd;

  const resolved = path.resolve(cwd, input);
  const normalizedAllowedRoots = allowedRoots.map((r) => path.resolve(cwd, r));

  const allowed = normalizedAllowedRoots.some((root) => {
    const normalizedRoot = path.resolve(root);
    if (resolved === normalizedRoot) return true;
    return isWithinRoot(resolved, normalizedRoot);
  });

  if (!allowed) {
    const rootsList = normalizedAllowedRoots.join(', ');
    throw new Error(
      `Refusing to scan outside allowed roots. Requested: ${resolved}. Allowed roots: ${rootsList}. ` +
        `Set SCHECK_MCP_ALLOWED_ROOTS (or MCP_ALLOWED_ROOTS) to override.`
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Target path does not exist: ${resolved}`);
  }

  return resolved;
}

export type EvidenceForMcp = { file: string; line: number; context?: string };

export function formatEvidenceForMcp(
  evidence: EvidenceForMcp[],
  includeContext: boolean
): EvidenceForMcp[] {
  if (includeContext) return evidence;
  return evidence.map(({ file, line }) => ({ file, line }));
}
