// Copyright (c) 2026 Flavio Cerato
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MASTER_KEY_RAW = process.env.APP_MASTER_KEY || 'dummy_key_at_least_32_characters_long';
const MASTER_KEY = Buffer.alloc(32, 0);
Buffer.from(MASTER_KEY_RAW, 'utf-8').copy(MASTER_KEY);

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(data: Buffer | string): string {
    const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : data;
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(tag);

    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

export function encryptJSON(obj: any): string {
    return encrypt(JSON.stringify(obj));
}

export function decryptJSON(data: Buffer | string): any {
    return JSON.parse(decrypt(data));
}
