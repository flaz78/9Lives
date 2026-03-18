import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    base: '/ui/',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    server: {
        port: 3000,
    }
});
