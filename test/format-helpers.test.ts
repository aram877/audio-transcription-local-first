import { describe, expect, it } from 'vitest';
import { fmtBytes, fmtTime } from '../src/ui/shared/format';

describe('fmtTime', () => {
  it('formats seconds as mm:ss', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(65)).toBe('01:05');
    expect(fmtTime(3599)).toBe('59:59');
  });

  it('survives the non-finite durations recorded WebM reports', () => {
    // These exact values crashed the old renderer (crash.log: "The provided
    // double value is non-finite" on HTMLMediaElement.currentTime).
    expect(fmtTime(Infinity)).toBe('00:00');
    expect(fmtTime(NaN)).toBe('00:00');
    expect(fmtTime(-5)).toBe('00:00');
  });
});

describe('fmtBytes', () => {
  it('picks a sensible unit', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(10 * 1024)).toBe('10 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('returns empty for zero/undefined', () => {
    expect(fmtBytes(0)).toBe('');
    expect(fmtBytes(undefined)).toBe('');
  });
});
