import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Recursively finds all __manifest__.py files under a directory. */
async function findManifests(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entries = (await (readdir as any)(dir, { recursive: true })) as string[];
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.endsWith('__manifest__.py')) {
      results.push(join(dir, entry));
    }
  }
  return results;
}

/** Extracts the python list from external_dependencies in a manifest file content. */
function extractPythonDeps(content: string): string[] {
  // Match the external_dependencies block (handles both single and double quotes)
  const depsBlock = content.match(/['"]external_dependencies['"]\s*:\s*\{([^}]*)\}/s);
  if (!depsBlock) return [];
  const pyList = depsBlock[1].match(/['"]python['"]\s*:\s*\[([^\]]*)\]/s);
  if (!pyList) return [];
  return [...pyList[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]!);
}

export interface ManifestScanResult {
  deps: string[];           // unique python deps found
  manifestCount: number;    // number of manifests scanned
}

/**
 * Scans all __manifest__.py files under customPath and returns
 * the unique set of python external_dependencies found.
 */
export async function scanManifestDependencies(customPath: string): Promise<ManifestScanResult> {
  const manifests = await findManifests(customPath);
  const seen = new Set<string>();

  for (const path of manifests) {
    try {
      const content = await readFile(path, 'utf-8');
      for (const dep of extractPythonDeps(content)) {
        seen.add(dep);
      }
    } catch { /* skip unreadable files */ }
  }

  return { deps: [...seen].sort(), manifestCount: manifests.length };
}
