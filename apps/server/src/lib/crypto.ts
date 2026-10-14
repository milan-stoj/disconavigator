import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyFrom(appSecret: string): Buffer {
  if (!appSecret) throw new Error('APP_SECRET must be set to store secrets');
  return createHash('sha256').update(`disco-controller:secrets:${appSecret}`).digest();
}

/** Encrypts a secret with AES-256-GCM. The output is `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encryptSecret(plain: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(appSecret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(encoded: string, appSecret: string): string {
  const [version, iv, tag, data] = encoded.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error('Unrecognised secret format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(appSecret),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
