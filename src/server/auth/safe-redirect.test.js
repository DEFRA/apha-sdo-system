import { getSafeRedirect } from './safe-redirect.js'

describe('getSafeRedirect', () => {
  test('keeps a path within the service', () => {
    expect(getSafeRedirect('/bat-rabies')).toBe('/bat-rabies')
    expect(getSafeRedirect('/bat-rabies/report-date')).toBe(
      '/bat-rabies/report-date'
    )
  })

  test('keeps a query string', () => {
    expect(getSafeRedirect('/bat-rabies?page=2')).toBe('/bat-rabies?page=2')
  })

  test.each([
    ['an absolute URL', 'https://evil.test/phish'],
    ['a protocol-relative URL', '//evil.test'],
    ['a backslash protocol-relative URL', '/\\evil.test'],
    ['a triple-slash URL', '///evil.test'],
    ['a scheme without a slash', 'javascript:alert(1)'],
    ['a relative path', 'bat-rabies'],
    ['an empty string', ''],
    ['a missing value', undefined],
    ['a null value', null],
    ['a non-string', 42]
  ])('replaces %s with the default destination', (_label, redirect) => {
    expect(getSafeRedirect(redirect)).toBe('/submission-welcome')
  })

  test.each([
    '/sign-in-choose',
    '/sign-in-entra',
    '/signin-entra-id',
    '/sign-out',
    '/signed-out'
  ])('replaces the auth path %s, which cannot be returned to', (redirect) => {
    expect(getSafeRedirect(redirect)).toBe('/submission-welcome')
  })

  test('uses a caller supplied fallback', () => {
    expect(getSafeRedirect('//evil.test', '/')).toBe('/')
  })
})
