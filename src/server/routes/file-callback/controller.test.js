import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { redisUploadStore } from '#/server/services/redis-upload-store.js'

vi.mock('#/server/services/redis-upload-store.js', () => ({
  redisUploadStore: { setUpload: vi.fn() }
}))

const callbackPayload = {
  uploadStatus: 'ready',
  metadata: { retrievalKey: 'someone@example.com' },
  form: {
    yourEmail: 'someone@example.com',
    supportingDocuments: {
      fileId: 'file-1',
      filename: 'data.xlsx',
      fileStatus: 'complete',
      contentLength: 1024,
      s3Bucket: 'apha-sdo-uploads',
      s3Key: 'staging/upload-1/file-1'
    }
  },
  numberOfRejectedFiles: 0
}

describe('#fileCallbackController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    redisUploadStore.setUpload.mockResolvedValue(true)
  })

  test('acknowledges the callback and records the scan outcome', async () => {
    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/file',
      payload: callbackPayload
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual({ message: 'success' })

    expect(redisUploadStore.setUpload).toHaveBeenCalledWith(
      'file-1',
      expect.objectContaining({
        type: 'scan',
        fileId: 'file-1',
        filename: 'data.xlsx',
        fileStatus: 'complete',
        s3Bucket: 'apha-sdo-uploads',
        s3Key: 'staging/upload-1/file-1',
        uploadStatus: 'ready'
      })
    )
  })

  test('still acknowledges when recording the scan outcome fails', async () => {
    redisUploadStore.setUpload.mockRejectedValue(new Error('redis down'))

    const { result, statusCode } = await server.inject({
      method: 'POST',
      url: '/file',
      payload: callbackPayload
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual({ message: 'success' })
  })

  test('acknowledges callbacks without file fields', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/file',
      payload: { uploadStatus: 'ready', form: {}, numberOfRejectedFiles: 0 }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(redisUploadStore.setUpload).not.toHaveBeenCalled()
  })
})
