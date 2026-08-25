import { buildBreadcrumbs } from './build-breadcrumbs.js'
import { reportTypes } from '#/server/forms/report-types.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildBreadcrumbs', () => {
  test('Should provide expected breadcrumbs for the submission welcome page', () => {
    expect(
      buildBreadcrumbs(mockRequest({ path: '/submission-welcome' }))
    ).toEqual([{ text: 'Home', href: '/' }, { text: 'Submission Welcome' }])
  })

  test.each(reportTypes)(
    'Should provide expected breadcrumbs for the $slug journey',
    ({ slug, title }) => {
      expect(
        buildBreadcrumbs(mockRequest({ path: `/${slug}/report-date` }))
      ).toEqual([
        { text: 'Home', href: '/' },
        { text: 'Submission Welcome', href: '/submission-welcome' },
        { text: title }
      ])
    }
  )

  test('Should provide the same breadcrumbs for every page of a journey', () => {
    const [{ slug }] = reportTypes
    const pages = ['/report-date', '/files-upload', '/summary', '/status']

    const trails = pages.map((page) =>
      buildBreadcrumbs(mockRequest({ path: `/${slug}${page}` }))
    )

    for (const trail of trails) {
      expect(trail).toEqual(trails[0])
    }
  })

  test('Should not link the current page', () => {
    const trail = buildBreadcrumbs(mockRequest({ path: '/submission-welcome' }))

    expect(trail.at(-1)).not.toHaveProperty('href')
  })

  test.each([
    ['the home page', '/'],
    ['a sign-in page', '/sign-in-choose'],
    ['an unknown form journey', '/not-a-report/report-date'],
    ['a page with no path', undefined]
  ])('Should provide no breadcrumbs for %s', (_name, path) => {
    expect(buildBreadcrumbs(mockRequest({ path }))).toEqual([])
  })

  test('Should provide no breadcrumbs without a request', () => {
    expect(buildBreadcrumbs()).toEqual([])
  })
})
