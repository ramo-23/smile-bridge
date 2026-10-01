import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + AUTH_TAG_LENGTH;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('ENCRYPTION_KEY'), 'base64');
    if (this.key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  encrypt(value: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(value: Buffer): string {
    if (value.length < HEADER_LENGTH || value[0] !== KEY_VERSION) {
      throw new Error('Encrypted value has an unsupported or invalid format');
    }
    const iv = value.subarray(1, 1 + IV_LENGTH);
    const authTag = value.subarray(1 + IV_LENGTH, HEADER_LENGTH);
    const ciphertext = value.subarray(HEADER_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
