import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';

describe('secret encryption', () => {
  const secret = 'app-secret-0123456789abcdef';

  it('round-trips with a fresh IV each time', () => {
    const a = encryptSecret('EAAA-token', secret);
    const b = encryptSecret('EAAA-token', secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain('EAAA-token');
    expect(decryptSecret(a, secret)).toBe('EAAA-token');
  });

  it('fails with the wrong key or tampered ciphertext', () => {
    const enc = encryptSecret('EAAA-token', secret);
    expect(() => decryptSecret(enc, 'another-secret-entirely')).toThrow();
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), secret)).toThrow();
  });
});
