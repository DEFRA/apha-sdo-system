import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    hookTimeout: 60000,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './test-results/junit.xml'
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.js'],
      lines: 90,
      functions: 90,
      branches: 90,
      statements: 90,
      exclude: [
        ...configDefaults.exclude,
        '.public',
        'coverage',
        'src/index.js',
        'src/client/**',
        'postcss.config.js',
        'stylelint.config.js',
        'vitest.config.js',
        '.sonarlint',
        'babel.config.cjs'
      ]
    }
  }
})
