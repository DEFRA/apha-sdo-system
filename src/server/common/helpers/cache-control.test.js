import { vi } from 'vitest'

import { setCacheControlHeaders } from './cache-control.js'

function createRequest(path, response = {}) {
  return {
    path,
    response: {
      headers: {},
      header: vi.fn(function (name, value) {
        this.headers[name] = value
      }),
      ...response
    }
  }
}

const toolkit = { continue: Symbol('continue') }

describe('setCacheControlHeaders', () => {
  test('keeps a page out of the browser cache', () => {
    const request = createRequest('/submission-welcome')

    expect(setCacheControlHeaders(request, toolkit)).toBe(toolkit.continue)
    expect(request.response.headers['cache-control']).toBe(
      'no-cache, no-store, must-revalidate'
    )
    expect(request.response.headers.pragma).toBe('no-cache')
    expect(request.response.headers.expires).toBe('0')
  })

  test.each(['/public/app.js', '/assets/govuk.css', '/favicon.ico', '/health'])(
    'leaves %s cacheable',
    (path) => {
      const request = createRequest(path)

      setCacheControlHeaders(request, toolkit)

      expect(request.response.header).not.toHaveBeenCalled()
    }
  )

  test('leaves a response that chose its own policy alone', () => {
    const request = createRequest('/logout', {
      headers: { 'cache-control': 'no-store' }
    })

    setCacheControlHeaders(request, toolkit)

    expect(request.response.headers['cache-control']).toBe('no-store')
    expect(request.response.header).not.toHaveBeenCalled()
  })

  test('leaves a Boom error to the error handler', () => {
    const request = createRequest('/missing', { isBoom: true })

    expect(setCacheControlHeaders(request, toolkit)).toBe(toolkit.continue)
    expect(request.response.header).not.toHaveBeenCalled()
  })
})
