import { sanitiseRequestLog } from './logger-options.js'

describe('sanitiseRequestLog', () => {
  test('redacts OIDC values from the URL and parsed query', () => {
    const request = {
      method: 'get',
      url: '/signin-entra-id?code=secret-code&state=secret-state&safe=value',
      query: {
        code: 'secret-code',
        state: 'secret-state',
        safe: 'value'
      }
    }

    const result = sanitiseRequestLog(request)

    expect(result.url).not.toContain('secret-code')
    expect(result.url).not.toContain('secret-state')
    expect(result.url).toContain('safe=value')
    expect(result.query).toEqual({
      code: '[Redacted]',
      state: '[Redacted]',
      safe: 'value'
    })
  })

  test('leaves a request without sensitive query values unchanged', () => {
    const request = {
      method: 'get',
      url: '/submission-welcome',
      query: {}
    }

    expect(sanitiseRequestLog(request)).toEqual(request)
  })
})
