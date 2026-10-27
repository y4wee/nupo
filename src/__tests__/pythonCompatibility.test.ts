import { describe, it, expect } from 'vitest';
import {
  getOdooPythonReq,
  comparePythonVersions,
  majorMinor,
  isPythonVersionCompatible,
} from '../constants/pythonCompatibility.js';

describe('majorMinor', () => {
  it('extracts major.minor from a full version string', () => {
    expect(majorMinor('3.11.6')).toBe('3.11');
  });
});

describe('comparePythonVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(comparePythonVersions('3.10', '3.10')).toBe(0);
  });
  it('returns negative when a < b', () => {
    expect(comparePythonVersions('3.9', '3.10')).toBeLessThan(0);
  });
  it('returns positive when a > b', () => {
    expect(comparePythonVersions('3.12.1', '3.12.0')).toBeGreaterThan(0);
  });
  it('treats a missing patch segment as 0', () => {
    expect(comparePythonVersions('3.10', '3.10.0')).toBe(0);
  });
});

describe('getOdooPythonReq', () => {
  it('returns the known requirement for a supported branch', () => {
    expect(getOdooPythonReq('17.0')).toEqual({ min: '3.10', recommended: '3.11', max: '3.12' });
  });
  it('falls back to the default requirement for an unknown branch', () => {
    expect(getOdooPythonReq('99.0')).toEqual({ min: '3.10', recommended: '3.12', max: '3.13' });
  });
});

describe('isPythonVersionCompatible', () => {
  it('accepts a version within [min, max] for the branch', () => {
    expect(isPythonVersionCompatible('3.11.0', '17.0')).toBe(true);
    expect(isPythonVersionCompatible('3.10.0', '17.0')).toBe(true);
    expect(isPythonVersionCompatible('3.12.0', '17.0')).toBe(true);
  });
  it('rejects a version below min', () => {
    expect(isPythonVersionCompatible('3.9.0', '17.0')).toBe(false);
  });
  it('rejects a version above max', () => {
    expect(isPythonVersionCompatible('3.13.0', '17.0')).toBe(false);
  });
});
