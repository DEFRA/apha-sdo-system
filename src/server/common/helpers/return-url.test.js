import {
  isSafeReturnUrl,
  stripUnsafeReturnUrl
} from '#/server/common/helpers/return-url.js'

const h = { continue: Symbol('continue') }

function buildRequest(query) {
  return {
    path: '/bat-rabies/report-date',
    query,
    logger: { warn: vi.fn() }
  }
}

describe('#isSafeReturnUrl', () => {
  test.each([
    '/bat-rabies/summary',
    '/animal-health-regulations-web-form/report-entries?x=1',
    '/'
  ])('Should keep a path within the service: %s', (url) => {
    expect(isSafeReturnUrl(url)).toBe(true)
  })

  test.each([
    '//other.site/phish',
    '/\\other.site/phish',
    'https://other.site',
    'other.site',
    '',
    undefined,
    null,
    42
  ])('Should refuse anything else: %s', (url) => {
    expect(isSafeReturnUrl(url)).toBe(false)
  })
})

describe('#stripUnsafeReturnUrl', () => {
  test('Should leave a return URL within the service alone', () => {
    const request = buildRequest({ returnUrl: '/bat-rabies/summary', a: '1' })

    expect(stripUnsafeReturnUrl(request, h)).toBe(h.continue)
    expect(request.query).toEqual({ returnUrl: '/bat-rabies/summary', a: '1' })
    expect(request.logger.warn).not.toHaveBeenCalled()
  })

  test('Should drop, and log, a return URL leading off the service', () => {
    const request = buildRequest({ returnUrl: '//other.site', a: '1' })

    expect(stripUnsafeReturnUrl(request, h)).toBe(h.continue)
    expect(request.query).toEqual({ a: '1' })
    expect(request.logger.warn).toHaveBeenCalledWith(
      { returnUrl: '//other.site', path: '/bat-rabies/report-date' },
      'Ignoring a return URL outside the service'
    )
  })

  test('Should do nothing to a request without a return URL', () => {
    const request = buildRequest({ a: '1' })

    stripUnsafeReturnUrl(request, h)

    expect(request.query).toEqual({ a: '1' })
  })

  test('Should cope with a request without a query or logger', () => {
    expect(stripUnsafeReturnUrl({}, h)).toBe(h.continue)
    expect(stripUnsafeReturnUrl({ query: { returnUrl: 'https://x' } }, h)).toBe(
      h.continue
    )
  })
})
