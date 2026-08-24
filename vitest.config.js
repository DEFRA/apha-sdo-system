import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    hookTimeout: 60000,
    env: {
      APP_BASE_URL: 'http://localhost:3000',
      AUTH_ENTRA_ID_CREDENTIAL_MODE: 'mock',
      AUTH_ENTRA_ID_OIDC_CONFIGURATION_URL:
        'http://localhost:5556/.well-known/openid-configuration',
      AUTH_ENTRA_ID_CLIENT_ID: 'local-stub-client',
      AUTH_ENTRA_ID_AUTHORIZATION_MODE: 'groups',
      AUTH_ENTRA_ID_ALLOWED_GROUP_IDS: 'local-dev-group',
      SESSION_COOKIE_SECURE: 'false'
    },
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
        'postcss.config.js',
        'stylelint.config.js',
        'vitest.config.js',
        '.sonarlint',
        'babel.config.cjs'
      ]
    }
  }
})
