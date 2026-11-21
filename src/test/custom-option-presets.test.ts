import { describe, it, expect } from 'bun:test';
import {
  CUSTOM_OPTION_PRESETS,
  addPresetOptions,
} from '@/lib/custom-option-presets';

describe('custom option presets', () => {
  const preset = CUSTOM_OPTION_PRESETS[0];

  it('has unique ids and a description for every preset', () => {
    const ids = CUSTOM_OPTION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CUSTOM_OPTION_PRESETS) {
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.options.startsWith('-')).toBe(true);
    }
  });

  it('fills an empty box', () => {
    expect(addPresetOptions(undefined, preset)).toBe(preset.options);
  });

  it('appends to existing options', () => {
    expect(addPresetOptions('-tune film', preset)).toBe(
      `-tune film ${preset.options}`,
    );
  });

  it('does not add the same preset twice', () => {
    const once = addPresetOptions('-tune film', preset);
    expect(addPresetOptions(once, preset)).toBe(once);
  });
});
