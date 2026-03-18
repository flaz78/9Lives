import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@db:5432/ninelives"
});

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MASTER_KEY_RAW = process.env.APP_MASTER_KEY || 'dummy_key_at_least_32_characters_long';
const MASTER_KEY = Buffer.alloc(32, 0);
Buffer.from(MASTER_KEY_RAW, 'utf-8').copy(MASTER_KEY);

function decrypt(data) {
    const buf = Buffer.from(data, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

async function main() {
    try {
        const res = await pool.query("SELECT ciphertext FROM secrets WHERE key='telegram.bots'");
        if (res.rows.length === 0) {
            console.log("No bots configured");
            return;
        }
        const decrypted = decrypt(res.rows[0].ciphertext);
        console.log("Decrypted Config:");
        console.log(JSON.stringify(JSON.parse(decrypted), null, 2));
    } catch (e) {
        console.error("Error:", e.message);
    } finally {
        await pool.end();
    }
}

main();
