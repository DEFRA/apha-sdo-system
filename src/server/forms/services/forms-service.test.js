import { describe, expect, it } from 'vitest'

import { formsService } from './forms-service.js'

describe('formsService', () => {
  describe('getFormMetadata', () => {
    it('returns metadata for a known slug', async () => {
      const metadata = await formsService.getFormMetadata('sdo-test')

      expect(metadata.slug).toBe('sdo-test')
      expect(metadata.id).toBe('b4c2d8e1-7f3a-4b96-9d05-8e6f1a2c3d40')
    })

    it('rejects when slug is unknown', async () => {
      await expect(
        formsService.getFormMetadata('unknown-form')
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 }
      })
    })
  })

  describe('getFormMetadataById', () => {
    it('returns metadata for a known id', async () => {
      const metadata = await formsService.getFormMetadataById(
        'c7f1a2b3-d4e5-4f60-8a1b-2c3d4e5f6a70'
      )

      expect(metadata.slug).toBe('example-application')
      expect(metadata.id).toBe('c7f1a2b3-d4e5-4f60-8a1b-2c3d4e5f6a70')
    })

    it('rejects when id is unknown', async () => {
      await expect(
        formsService.getFormMetadataById('unknown-id')
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 }
      })
    })
  })

  describe('getFormDefinition', () => {
    it('returns form definition for a known id', async () => {
      const definition = await formsService.getFormDefinition(
        'b4c2d8e1-7f3a-4b96-9d05-8e6f1a2c3d40',
        {}
      )

      expect(definition.engine).toBe('V2')
      expect(definition.name).toBe('SDO test')
    })

    it('rejects when definition id is unknown', async () => {
      await expect(
        formsService.getFormDefinition('missing-id', {})
      ).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 }
      })
    })
  })
})
