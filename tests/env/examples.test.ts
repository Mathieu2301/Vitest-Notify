import { describe, it, expect } from 'vitest';

describe('process.env', () => {
  it('should be defined', () => {
    expect(process.env).toBeDefined();
  });
});

describe('process.env.NODE_ENV', () => {
  it('should be defined', () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });

  it('should be \'test\'', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });
});
