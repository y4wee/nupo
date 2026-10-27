import { describe, it, expect } from 'vitest';
import {
  sortedOdooVersions,
  getPrimaryColor,
  getSecondaryColor,
  getTextColor,
  getCursorColor,
  DEFAULT_CONFIG,
  type OdooVersion,
  type NupoConfig,
} from '../types/index.js';

describe('sortedOdooVersions', () => {
  it('sorts by major then minor, descending', () => {
    const versions: OdooVersion[] = [
      { branch: '16.0', path: '/a' },
      { branch: '18.0', path: '/b' },
      { branch: '17.0', path: '/c' },
    ];
    expect(sortedOdooVersions(versions).map(v => v.branch)).toEqual(['18.0', '17.0', '16.0']);
  });

  it('does not mutate the input array', () => {
    const versions: OdooVersion[] = [{ branch: '16.0', path: '/a' }, { branch: '18.0', path: '/b' }];
    const copy = [...versions];
    sortedOdooVersions(versions);
    expect(versions).toEqual(copy);
  });

  it('handles branches without a parseable minor segment', () => {
    const versions: OdooVersion[] = [{ branch: 'saas-17.1', path: '/a' }, { branch: '17.0', path: '/b' }];
    expect(() => sortedOdooVersions(versions)).not.toThrow();
  });

  it('returns an empty array for an empty input', () => {
    expect(sortedOdooVersions([])).toEqual([]);
  });
});

describe('color getters', () => {
  it('fall back to defaults when config is null/undefined', () => {
    expect(getPrimaryColor(null)).toBe('#9F0C58');
    expect(getSecondaryColor(undefined)).toBe('#E79439');
    expect(getTextColor(null)).toBe('#848484');
    expect(getCursorColor(undefined)).toBe('cyan');
  });

  it('fall back to defaults when the field is unset on the config', () => {
    const config = { ...DEFAULT_CONFIG, primary_color: undefined } as NupoConfig;
    expect(getPrimaryColor(config)).toBe('#9F0C58');
  });

  it('return the configured value when present', () => {
    const config: NupoConfig = { ...DEFAULT_CONFIG, primary_color: '#111111', secondary_color: '#222222', text_color: '#333333', cursor_color: 'red' };
    expect(getPrimaryColor(config)).toBe('#111111');
    expect(getSecondaryColor(config)).toBe('#222222');
    expect(getTextColor(config)).toBe('#333333');
    expect(getCursorColor(config)).toBe('red');
  });
});
