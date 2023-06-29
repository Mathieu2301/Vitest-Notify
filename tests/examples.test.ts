import { describe, it, expect } from 'vitest';

describe('true', () => {
  it('should be true', () => {
    expect(true).toBe(true);
  });
});

describe.skip('false', () => {
  it('should be true', () => {
    expect(false).toBe(true);
  });
});

it.skip('should be skipped', () => {
  expect(false).toBe(true);
});
it.todo('should be todo', () => {
  expect(false).toBe(true);
});

describe('10', () => {
  it('should be 10', () => {
    expect(10).toBe(10);
  });
  it('should not be 11', () => {
    expect(10).not.toBe(11);
  });
});

