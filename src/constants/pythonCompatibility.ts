export interface PythonRequirement {
  recommended: string;
  min: string;
  max: string;
}

// Sources: Odoo setup.py + community testing experience
// Key breakage: Python 3.12 removed distutils → breaks Odoo ≤15
//               Python 3.11 breaks some lxml/collections.abc usage in Odoo ≤13
const COMPAT: Record<string, PythonRequirement> = {
  '13.0': { min: '3.6', recommended: '3.8',  max: '3.10' },
  '14.0': { min: '3.6', recommended: '3.8',  max: '3.11' },
  '15.0': { min: '3.7', recommended: '3.10', max: '3.11' },
  '16.0': { min: '3.10', recommended: '3.10', max: '3.11' },
  '17.0': { min: '3.10', recommended: '3.11', max: '3.12' },
  '18.0': { min: '3.10', recommended: '3.12', max: '3.12' },
  '19.0': { min: '3.10', recommended: '3.12', max: '3.13' },
};

const FALLBACK: PythonRequirement = { min: '3.10', recommended: '3.12', max: '3.13' };

export function getOdooPythonReq(branch: string): PythonRequirement {
  return COMPAT[branch] ?? FALLBACK;
}

/** Compare two "X.Y" or "X.Y.Z" version strings. Returns negative / 0 / positive. */
export function comparePythonVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Returns "X.Y" from "X.Y.Z" */
export function majorMinor(version: string): string {
  const [maj, min] = version.split('.');
  return `${maj}.${min}`;
}

export function isPythonVersionCompatible(pythonVersion: string, branch: string): boolean {
  const req = getOdooPythonReq(branch);
  return (
    comparePythonVersions(pythonVersion, req.min) >= 0 &&
    comparePythonVersions(pythonVersion, req.max) <= 0
  );
}
