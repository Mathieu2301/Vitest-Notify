import { describe, it, expect } from 'vitest';

for (let i = 0; i < 8; i += 1) {
  describe(`Test nº${i}`, () => {
    it('should randomly fail', () => {
      expect([]).toHaveLength(Math.round(Math.random()));
    })
  });
}
