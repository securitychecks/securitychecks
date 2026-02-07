import { readdir, access } from 'fs/promises';
import { join } from 'path';

export type PartitionKind = 'workspace' | 'root' | 'app' | 'package';

export interface PartitionInfo {
  root: string;
  relativePath: string;
  kind: PartitionKind;
  packageJsonPath?: string;
  tsconfigPath?: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverChildPartitions(
  basePath: string,
  kind: PartitionKind,
  targetPath: string
): Promise<PartitionInfo[]> {
  if (!(await pathExists(basePath))) {
    return [];
  }

  let entries: string[] = [];
  try {
    entries = await readdir(basePath);
  } catch {
    return [];
  }

  entries.sort();

  const partitions: PartitionInfo[] = [];

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const candidateRoot = join(basePath, entry);
    const packageJsonPath = join(candidateRoot, 'package.json');
    const tsconfigPath = join(candidateRoot, 'tsconfig.json');

    const hasPackage = await pathExists(packageJsonPath);
    const hasTsconfig = await pathExists(tsconfigPath);

    if (!hasPackage && !hasTsconfig) continue;

    partitions.push({
      root: candidateRoot,
      relativePath: candidateRoot.replace(targetPath + '/', ''),
      kind,
      packageJsonPath: hasPackage ? packageJsonPath : undefined,
      tsconfigPath: hasTsconfig ? tsconfigPath : undefined,
    });
  }

  return partitions;
}

export async function discoverPartitions(targetPath: string): Promise<PartitionInfo[]> {
  const appsPath = join(targetPath, 'apps');
  const packagesPath = join(targetPath, 'packages');

  const appPartitions = await discoverChildPartitions(appsPath, 'app', targetPath);
  const packagePartitions = await discoverChildPartitions(packagesPath, 'package', targetPath);

  const hasWorkspaceChildren = appPartitions.length > 0 || packagePartitions.length > 0;

  const rootPackageJsonPath = join(targetPath, 'package.json');
  const rootTsconfigPath = join(targetPath, 'tsconfig.json');
  const hasRootPackage = await pathExists(rootPackageJsonPath);
  const hasRootTsconfig = await pathExists(rootTsconfigPath);

  const rootPartition: PartitionInfo = {
    root: targetPath,
    relativePath: '',
    kind: hasWorkspaceChildren ? 'workspace' : 'root',
    packageJsonPath: hasRootPackage ? rootPackageJsonPath : undefined,
    tsconfigPath: hasRootTsconfig ? rootTsconfigPath : undefined,
  };

  return [rootPartition, ...appPartitions, ...packagePartitions];
}
