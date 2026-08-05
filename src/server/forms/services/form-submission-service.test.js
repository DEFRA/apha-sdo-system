import { describe, expect, it } from 'vitest'

import { formSubmissionService } from './form-submission-service.js'

describe('formSubmissionService', () => {
  describe('persistFiles', () => {
    it('returns persisted file count and retrieval key', async () => {
      const files = [{ id: 'file-1' }, { id: 'file-2' }]
      const key = 'retrieval-key-1'

      await expect(formSubmissionService.persistFiles(files, key)).resolves.toEqual({
        persistedFiles: 2,
        persistedRetrievalKey: key
      })
    })
  })

  describe('submit', () => {
    it('returns submit response payload with main and repeater file ids', async () => {
      const data = {
        repeaters: [{ name: 'animals' }, { name: 'locations' }]
      }

      const result = await formSubmissionService.submit(data)

      expect(result.message).toBe('Submit completed')
      expect(result.result.files.main).toEqual(expect.any(String))
      expect(result.result.files.repeaters).toEqual({
        animals: expect.any(String),
        locations: expect.any(String)
      })
    })

    it('returns empty repeater map when no repeaters are provided', async () => {
      const data = { repeaters: [] }

      const result = await formSubmissionService.submit(data)

      expect(result.result.files.repeaters).toEqual({})
    })
  })
})
