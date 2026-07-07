import { describe, it, expect } from 'vitest';
import { formatBytes } from '../../src/util/formatBytes.js';

describe('formatBytes', () => {
  it('formats zero as "0 B"', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats sub-kilobyte values as integer bytes', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('formats exact 1024 B as "1.0 KB"', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats kilobytes with one decimal place', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1023)).toBe('1023.0 KB');
  });

  it('crosses into MB at 1024 KB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats megabytes with one decimal place', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });

  it('crosses into GB at 1024 MB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('formats gigabytes with one decimal place', () => {
    expect(formatBytes(2.3 * 1024 * 1024 * 1024)).toBe('2.3 GB');
    expect(formatBytes(5.6 * 1024 * 1024 * 1024)).toBe('5.6 GB');
  });

  it('caps at GB even for terabyte-range inputs', () => {
    // 2 TB → 2048 GB → "2048.0 GB" (does not switch to TB)
    expect(formatBytes(2 * 1024 * 1024 * 1024 * 1024)).toBe('2048.0 GB');
  });

  it('returns "?" for negative / NaN / Infinity inputs', () => {
    expect(formatBytes(-1)).toBe('?');
    expect(formatBytes(Number.NaN)).toBe('?');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('?');
  });
});