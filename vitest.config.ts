import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    coverage: {
      provider: 'v8',
      // Règles financières pures : toutes les branches doivent être couvertes (ticket 009).
      include: ['src/domains/finance/rules.ts'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' } },
      {
        extends: true,
        test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 20000, fileParallelism: false },
      },
    ],
  },
})
