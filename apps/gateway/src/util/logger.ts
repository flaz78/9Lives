// Copyright (c) 2026 Flavio Cerato
export const logger = {
    info: (msg: string) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
    error: (msg: string, err?: any) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err),
    warn: (msg: string, err?: any) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`, err),
};
