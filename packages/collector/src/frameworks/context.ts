import type { AuditConfig } from '../types.js';
import { discoverPartitions, type PartitionInfo } from '../partitions.js';
import { detectFrameworks, type FrameworkDetection } from './detect.js';
import { applyFrameworkProfiles } from './profiles.js';

const contextCache = new Map<string, Promise<FrameworkContext>>();

export interface PartitionFrameworkContext extends PartitionInfo {
  frameworks: string[];
  frameworkVersions: Record<string, string>;
  signals: FrameworkDetection['signals'];
  effectiveFrameworks: string[];
  effectiveFrameworkVersions: Record<string, string>;
}

export interface FrameworkContext {
  frameworks: string[];
  frameworkVersions: Record<string, string>;
  partitions: PartitionFrameworkContext[];
}

function mergeFrameworkVersions(
  primary: Record<string, string>,
  secondary: Record<string, string>
): Record<string, string> {
  return { ...primary, ...secondary };
}

function mergeFrameworkLists(primary: string[], secondary: string[]): string[] {
  const merged = new Set(primary);
  for (const entry of secondary) {
    merged.add(entry);
  }
  return Array.from(merged).sort();
}

export async function detectFrameworkContext(targetPath: string): Promise<FrameworkContext> {
  const cached = contextCache.get(targetPath);
  if (cached) {
    return cached;
  }

  const resolved = (async (): Promise<FrameworkContext> => {
    const partitions = await discoverPartitions(targetPath);
    const rootPartition = partitions[0];

    const rootDetection = rootPartition
      ? await detectFrameworks(rootPartition.root)
      : { frameworks: [], frameworkVersions: {}, signals: [] };

    const rootFrameworks = rootDetection.frameworks;
    const rootVersions = rootDetection.frameworkVersions;

    const partitionContexts: PartitionFrameworkContext[] = [];
    for (const partition of partitions) {
      const detection =
        partition === rootPartition ? rootDetection : await detectFrameworks(partition.root);
      const effectiveFrameworks = mergeFrameworkLists(rootFrameworks, detection.frameworks);
      const effectiveFrameworkVersions = mergeFrameworkVersions(
        rootVersions,
        detection.frameworkVersions
      );
      partitionContexts.push({
        ...partition,
        frameworks: detection.frameworks,
        frameworkVersions: detection.frameworkVersions,
        signals: detection.signals,
        effectiveFrameworks,
        effectiveFrameworkVersions,
      });
    }

    const combinedFrameworks = new Set<string>();
    let combinedVersions: Record<string, string> = {};
    for (const partition of partitionContexts) {
      for (const fw of partition.effectiveFrameworks) {
        combinedFrameworks.add(fw);
      }
      combinedVersions = mergeFrameworkVersions(combinedVersions, partition.frameworkVersions);
    }

    return {
      frameworks: Array.from(combinedFrameworks).sort(),
      frameworkVersions: combinedVersions,
      partitions: partitionContexts,
    };
  })();

  contextCache.set(targetPath, resolved);
  return resolved;
}

export async function applyFrameworkOverrides(
  targetPath: string,
  config: AuditConfig
): Promise<{ config: AuditConfig; context: FrameworkContext }> {
  const context = await detectFrameworkContext(targetPath);
  const adjusted = applyFrameworkProfiles(config, context.frameworks);
  return { config: adjusted, context };
}
