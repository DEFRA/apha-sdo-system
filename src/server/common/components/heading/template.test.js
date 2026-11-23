import { renderComponent } from '#/test-helpers/component-helpers.js'

describe('Heading Component', () => {
  let $heading

  describe('With caption', () => {
    beforeEach(() => {
      $heading = renderComponent('heading', {
        text: 'Services',
        caption: 'A page showing available services'
      })
    })

    test('Should render app heading component', () => {
      expect($heading('[data-testid="app-heading"]')).toHaveLength(1)
    })

    test('Should contain expected heading', () => {
      expect($heading('[data-testid="app-heading-title"]').text().trim()).toBe(
        'Services'
      )
    })

    test('Should have expected heading caption', () => {
      expect(
        $heading('[data-testid="app-heading-caption"]').text().trim()
      ).toBe('A page showing available services')
    })

    test('Should sit in a two-thirds column by default', () => {
      expect($heading('[data-testid="app-heading-column"]').attr('class')).toBe(
        'govuk-grid-column-two-thirds'
      )
    })
  })

  describe('With a width', () => {
    beforeEach(() => {
      $heading = renderComponent('heading', {
        text: 'Services',
        width: 'three-quarters'
      })
    })

    test('Should sit in a column of that width', () => {
      expect($heading('[data-testid="app-heading-column"]').attr('class')).toBe(
        'govuk-grid-column-three-quarters'
      )
    })

    test('Should leave out the caption when there is none', () => {
      expect($heading('[data-testid="app-heading-caption"]')).toHaveLength(0)
    })
  })
})
