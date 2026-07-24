import Boom from '@hapi/boom'

import * as exampleApplication from '../definitions/example-application.js'
import * as sdoTest from '../definitions/sdo-test.js'

/**
 * Register new forms here. Each entry is a module exporting `metadata` and
 * `definition` (see src/server/forms/definitions/example-application.js).
 */
const forms = [exampleApplication, sdoTest]

const formsBySlug = new Map(forms.map((form) => [form.metadata.slug, form]))
const formsById = new Map(forms.map((form) => [form.metadata.id, form]))

/**
 * Forms service used by @defra/forms-engine-plugin to look up form metadata
 * and definitions. Forms are defined in code and served from memory.
 */
export const formsService = {
  getFormMetadata(slug) {
    const form = formsBySlug.get(slug)

    if (!form) {
      return Promise.reject(Boom.notFound(`Form '${slug}' not found`))
    }

    return Promise.resolve(form.metadata)
  },

  getFormMetadataById(id) {
    const form = formsById.get(id)

    if (!form) {
      return Promise.reject(Boom.notFound(`Form with id '${id}' not found`))
    }

    return Promise.resolve(form.metadata)
  },

  getFormDefinition(id, _state) {
    const form = formsById.get(id)

    if (!form) {
      return Promise.reject(Boom.notFound(`Form with id '${id}' not found`))
    }

    return Promise.resolve(form.definition)
  }
}
