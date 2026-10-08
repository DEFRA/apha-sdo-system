import { vi } from 'vitest'

const mockReadFileSync = vi.fn()
const mockLoggerError = vi.fn()
// Config values a test wants to differ from the defaults
const mockConfigOverrides = new Map()

vi.mock('node:fs', async () => {
  const nodeFs = await import('node:fs')

  return {
    ...nodeFs,
    readFileSync: () => mockReadFileSync()
  }
})
vi.mock('../../../server/common/helpers/logging/logger.js', () => ({
  createLogger: () => ({ error: (...args) => mockLoggerError(...args) })
}))
vi.mock(import('#/config/config.js'), async (importOriginal) => {
  const originalModule = await importOriginal()
  return {
    config: {
      get(key) {
        if (key === 'isProduction') return true
        if (mockConfigOverrides.has(key)) return mockConfigOverrides.get(key)
        return originalModule.config.get(key)
      }
    }
  }
})

describe('context and cache', () => {
  beforeEach(() => {
    mockReadFileSync.mockReset()
    mockLoggerError.mockReset()
    mockConfigOverrides.clear()
    vi.resetModules()
  })

  describe('#context', () => {
    const mockRequest = { path: '/' }

    describe('When Vite manifest file read succeeds', () => {
      let contextImport
      let contextResult

      beforeAll(async () => {
        contextImport = await import('./context.js')
      })

      beforeEach(() => {
        // Return JSON string
        mockReadFileSync.mockReturnValue(`{
        "application.js": "javascripts/application.js",
        "stylesheets/application.scss": "stylesheets/application.css"
      }`)

        contextResult = contextImport.context(mockRequest)
      })

      test('Should provide expected context', () => {
        expect(contextResult).toEqual({
          assetPath: '/public/assets',
          breadcrumbs: [],
          getAssetPath: expect.any(Function),
          isAuthenticated: false,
          serviceName: 'apha-sdo-system',
          serviceUrl: '/',
          signedInUser: null,
          accountManagementUrl: null,
          identityRows: []
        })
      })

      test('Should expose authenticated user context', () => {
        const user = { id: 'user-id', name: 'A Person' }
        const authenticatedContext = contextImport.context({
          auth: {
            isAuthenticated: true,
            credentials: { user }
          }
        })

        expect(authenticatedContext.isAuthenticated).toBe(true)
        expect(authenticatedContext.signedInUser).toBe(user)
        // An Entra user has no Defra account to manage
        expect(authenticatedContext.accountManagementUrl).toBeNull()
      })

      test('Should link Defra Customer Identity users to Your Defra account', () => {
        mockConfigOverrides.set(
          'auth.defraId.accountManagementUrl',
          'https://your-account.example/management'
        )
        const defraIdUser = { id: 'user-id', provider: 'defraId' }

        expect(contextImport.accountManagementUrlFor(defraIdUser)).toBe(
          'https://your-account.example/management'
        )
        expect(
          contextImport.context({
            auth: { isAuthenticated: true, credentials: { user: defraIdUser } }
          }).accountManagementUrl
        ).toBe('https://your-account.example/management')
      })

      test('Should not link to Your Defra account when no URL is configured', () => {
        mockConfigOverrides.set('auth.defraId.accountManagementUrl', '')

        expect(
          contextImport.accountManagementUrlFor({ provider: 'defraId' })
        ).toBeNull()
      })

      describe('With valid asset path', () => {
        test('Should provide expected asset path', () => {
          expect(contextResult.getAssetPath('application.js')).toBe(
            '/public/application.js'
          )
        })
      })

      describe('With invalid asset path', () => {
        test('Should provide expected asset', () => {
          expect(contextResult.getAssetPath('an-image.png')).toBe(
            '/public/an-image.png'
          )
        })
      })
    })

    describe('When Vite manifest file read fails', () => {
      let contextImport

      beforeAll(async () => {
        contextImport = await import('./context.js')
      })

      beforeEach(() => {
        mockReadFileSync.mockReturnValue(new Error('File not found'))

        contextImport.context(mockRequest)
      })

      test('Should log that the Vite Manifest file is not available', () => {
        expect(mockLoggerError).toHaveBeenCalledWith(
          'Vite manifest.json not found'
        )
      })
    })
  })

  describe('#context cache', () => {
    const mockRequest = { path: '/' }
    let contextResult

    describe('Vite manifest file cache', () => {
      let contextImport

      beforeAll(async () => {
        contextImport = await import('./context.js')
      })

      beforeEach(() => {
        // Return JSON string
        mockReadFileSync.mockReturnValue(`{
        "application.js": "javascripts/application.js",
        "stylesheets/application.scss": "stylesheets/application.css"
      }`)

        contextResult = contextImport.context(mockRequest)
      })

      test('Should read file', () => {
        expect(mockReadFileSync).toHaveBeenCalled()
      })

      test('Should use cache', () => {
        expect(mockReadFileSync).not.toHaveBeenCalled()
      })

      test('Should provide expected context', () => {
        expect(contextResult).toEqual({
          assetPath: '/public/assets',
          breadcrumbs: [],
          getAssetPath: expect.any(Function),
          isAuthenticated: false,
          serviceName: 'apha-sdo-system',
          serviceUrl: '/',
          signedInUser: null,
          accountManagementUrl: null,
          identityRows: []
        })
      })
    })
  })
})
