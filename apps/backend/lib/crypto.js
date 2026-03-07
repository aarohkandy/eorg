import crypto from 'crypto';
import { AppError } from './errors.js';

const ALGORITHM = 'aes-256-cbc';

function getKey() {
  const value = process.env.ENCRYPTION_KEY || '';
  const key = Buffer.from(value, 'utf8');
  if (key.length !== 32) {
    throw new AppError(
      'BACKEND_UNAVAILABLE',
      'ENCRYPTION_KEY must be exactly 32 UTF-8 bytes.',
      500
    );
  }
  return key;
}

export function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encryptedText) {
  const [ivHex, encryptedHex] = String(encryptedText || '').split(':');
  if (!ivHex || !encryptedHex) {
    throw new AppError('BACKEND_UNAVAILABLE', 'Encrypted credential is malformed.', 500);
  }

  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
