import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetCdpUploaderConfig,
  mockRedisUploadStore,
  mockUuid,
  defaultUploaderConfig
} = vi.hoisted(() => ({
  mockGetCdpUploaderConfig: vi.fn(),
  mockRedisUploadStore: {
    setUpload: vi.fn(),
    getUpload: vi.fn(),
    updateUpload: vi.fn(),
    getAllUploads: vi.fn()
  },
  mockUuid: vi.fn(),
  defaultUploaderConfig: {
    url: 'https://uploader.test',
    bucket: 'test-bucket',
    stagingPrefix: 'staging/',
    callbackAuthToken: 'token-123',
    timeout: 1000,
    retryAttempts: 2
  }
}))

vi.mock('../../../config/upload-config.js', () => ({
  uploadConfig: {
    getCdpUploaderConfig: mockGetCdpUploaderConfig
  }
}))

vi.mock('../../services/redis-upload-store.js', () => ({
  redisUploadStore: mockRedisUploadStore
}))

vi.mock('uuid', () => ({
  v4: mockUuid
}))

import { CdpUploaderService } from './cdp-uploader-service.js'

describe('CdpUploaderService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCdpUploaderConfig.mockReturnValue(defaultUploaderConfig)
    mockUuid.mockReturnValue('local-uuid-123')
    mockRedisUploadStore.setUpload.mockResolvedValue(true)
    mockRedisUploadStore.getUpload.mockResolvedValue(null)
    mockRedisUploadStore.updateUpload.mockResolvedValue(true)
    mockRedisUploadStore.getAllUploads.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('uploadFile', () => {
    it('uploads a file and stores upload metadata', async () => {
      const service = new CdpUploaderService()
      const file = Buffer.from('hello')
      const metadata = {
        originalName: 'file.csv',
        contentType: 'text/csv'
      }

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ uploadId: 'cdp-upload-1' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ s3Key: 'staging/cdp-upload-1/file.csv' })
        })

      const result = await service.uploadFile({ file, metadata })

      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://uploader.test/initiate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
            'X-Request-ID': 'local-uuid-123'
          })
        })
      )
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://uploader.test/upload-and-scan/cdp-upload-1',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer token-123',
            'X-Request-ID': 'local-uuid-123'
          })
        })
      )
      expect(mockRedisUploadStore.setUpload).toHaveBeenCalledWith(
        'cdp-upload-1',
        expect.objectContaining({
          uploadId: 'cdp-upload-1',
          filename: 'file.csv',
          status: 'uploaded',
          fileBuffer: Buffer.from('hello').toString('base64')
        })
      )
      expect(result).toEqual({
        uploadId: 'cdp-upload-1',
        filename: 'file.csv',
        size: 5,
        s3Key: 'staging/cdp-upload-1/file.csv'
      })
    })

    it('stores failed upload details and throws when initiate fails', async () => {
      const service = new CdpUploaderService()

      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'boom'
      })

      await expect(
        service.uploadFile({
          file: Buffer.from('x'),
          metadata: { originalName: 'x.csv', contentType: 'text/csv' }
        })
      ).rejects.toThrow(
        'Upload failed: CDP uploader initiate failed: 500 - boom'
      )

      expect(mockRedisUploadStore.setUpload).toHaveBeenCalledWith(
        'local-uuid-123',
        expect.objectContaining({
          uploadId: 'local-uuid-123',
          filename: 'x.csv',
          status: 'failed'
        })
      )
    })
  })

  describe('getUploadStatus', () => {
    it('returns upload status from store', async () => {
      const service = new CdpUploaderService()
      mockRedisUploadStore.getUpload.mockResolvedValue({ status: 'uploaded' })

      await expect(service.getUploadStatus('upload-1')).resolves.toEqual({
        status: 'uploaded'
      })
      expect(mockRedisUploadStore.getUpload).toHaveBeenCalledWith('upload-1')
    })
  })

  describe('pollVirusScanStatus', () => {
    it('resolves immediately when local status is clean', async () => {
      vi.useFakeTimers()
      const service = new CdpUploaderService()
      mockRedisUploadStore.getUpload.mockResolvedValue({
        virusScanStatus: 'clean'
      })

      const pollPromise = service.pollVirusScanStatus('upload-2', 1, 10)
      await vi.advanceTimersByTimeAsync(10)

      await expect(pollPromise).resolves.toEqual({
        status: 'clean',
        uploadId: 'upload-2',
        localUpload: { virusScanStatus: 'clean' }
      })
    })

    it('updates store and resolves when CDP reports clean', async () => {
      vi.useFakeTimers()
      const service = new CdpUploaderService()
      mockRedisUploadStore.getUpload.mockResolvedValue({
        virusScanStatus: 'pending'
      })
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ virusScanStatus: 'clean', status: 'completed' })
      })

      const pollPromise = service.pollVirusScanStatus('upload-3', 2, 10)
      await vi.advanceTimersByTimeAsync(10)

      await expect(pollPromise).resolves.toMatchObject({
        status: 'clean',
        uploadId: 'upload-3'
      })
      expect(mockRedisUploadStore.updateUpload).toHaveBeenCalledWith(
        'upload-3',
        {
          virusScanStatus: 'clean',
          status: 'completed'
        }
      )
    })

    it('rejects with timeout when max attempts reached', async () => {
      vi.useFakeTimers()
      const service = new CdpUploaderService()
      mockRedisUploadStore.getUpload.mockResolvedValue({
        virusScanStatus: 'pending'
      })
      global.fetch.mockResolvedValue({ ok: false })

      const pollPromise = service.pollVirusScanStatus('upload-4', 1, 10)
      const rejection = expect(pollPromise).rejects.toThrow(
        'Virus scan polling timed out after 1 attempts'
      )
      await vi.advanceTimersByTimeAsync(10)
      await rejection
    })
  })

  describe('processUploadWithAzureTransfer', () => {
    it('transfers clean upload to Azure and marks complete', async () => {
      const service = new CdpUploaderService()
      const uploadData = {
        uploadId: 'upload-5',
        filename: 'sheet.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileBuffer: Buffer.from('sheet-content').toString('base64')
      }
      vi.spyOn(service, 'pollVirusScanStatus').mockResolvedValue({
        status: 'clean',
        uploadId: 'upload-5',
        localUpload: uploadData
      })

      const azureService = {
        uploadFile: vi.fn().mockResolvedValue({
          blobName: 'sheet.xlsx',
          url: 'https://azure/file'
        })
      }

      const result = await service.processUploadWithAzureTransfer(
        'upload-5',
        azureService
      )

      expect(azureService.uploadFile).toHaveBeenCalled()
      expect(mockRedisUploadStore.updateUpload).toHaveBeenCalledWith(
        'upload-5',
        expect.objectContaining({
          status: 'completed',
          azureTransferred: true,
          fileBuffer: null
        })
      )
      expect(result).toEqual({
        success: true,
        uploadId: 'upload-5',
        azureResult: {
          blobName: 'sheet.xlsx',
          url: 'https://azure/file'
        }
      })
    })

    it('marks transfer failed when scan is not clean', async () => {
      const service = new CdpUploaderService()
      vi.spyOn(service, 'pollVirusScanStatus').mockResolvedValue({
        status: 'infected'
      })

      await expect(
        service.processUploadWithAzureTransfer('upload-6', {
          uploadFile: vi.fn()
        })
      ).rejects.toThrow('File failed virus scan: infected')

      expect(mockRedisUploadStore.updateUpload).toHaveBeenCalledWith(
        'upload-6',
        expect.objectContaining({
          status: 'transfer_failed',
          fileBuffer: null
        })
      )
    })
  })

  describe('handleCallback', () => {
    it('merges callback into existing upload record', async () => {
      const service = new CdpUploaderService()
      mockRedisUploadStore.getUpload.mockResolvedValue({
        uploadId: 'upload-7',
        s3Key: 'old/key',
        error: null
      })

      await service.handleCallback({
        uploadId: 'upload-7',
        status: 'uploaded',
        virusScanStatus: 'clean',
        s3Key: 'new/key'
      })

      expect(mockRedisUploadStore.setUpload).toHaveBeenCalledWith(
        'upload-7',
        expect.objectContaining({
          status: 'virus_scan_complete',
          virusScanStatus: 'clean',
          s3Key: 'new/key'
        })
      )
    })

    it('stores callback as recovery record when upload is unknown', async () => {
      const service = new CdpUploaderService()
      mockRedisUploadStore.getUpload.mockResolvedValue(null)

      await service.handleCallback({
        uploadId: 'upload-8',
        status: 'failed',
        error: 'scan failed'
      })

      expect(mockRedisUploadStore.setUpload).toHaveBeenCalledWith(
        'upload-8',
        expect.objectContaining({
          uploadId: 'upload-8',
          status: 'failed',
          source: 'callback'
        })
      )
    })
  })

  describe('retryUpload', () => {
    it('retries then succeeds', async () => {
      vi.useFakeTimers()
      const service = new CdpUploaderService()
      const uploadSpy = vi
        .spyOn(service, 'uploadFile')
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValueOnce({ uploadId: 'ok' })

      const retryPromise = service.retryUpload('upload-9', Buffer.from('x'), {
        originalName: 'x.csv',
        contentType: 'text/csv'
      })
      await vi.advanceTimersByTimeAsync(1000)

      await expect(retryPromise).resolves.toEqual({ uploadId: 'ok' })
      expect(uploadSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('streamToBuffer', () => {
    it('returns original buffer when input is already a buffer', async () => {
      const service = new CdpUploaderService()
      const input = Buffer.from('buffer')

      await expect(service.streamToBuffer(input)).resolves.toBe(input)
    })

    it('converts a stream to buffer', async () => {
      const service = new CdpUploaderService()
      const stream = new EventEmitter()
      const promise = service.streamToBuffer(stream)

      process.nextTick(() => {
        stream.emit('data', Buffer.from('hello '))
        stream.emit('data', Buffer.from('world'))
        stream.emit('end')
      })

      await expect(promise).resolves.toEqual(Buffer.from('hello world'))
    })
  })

  describe('getAllUploads', () => {
    it('delegates to redis store', async () => {
      const service = new CdpUploaderService()
      mockRedisUploadStore.getAllUploads.mockResolvedValue([{ uploadId: '1' }])

      await expect(service.getAllUploads()).resolves.toEqual([
        { uploadId: '1' }
      ])
      expect(mockRedisUploadStore.getAllUploads).toHaveBeenCalled()
    })
  })

  describe('healthCheck', () => {
    it('returns healthy response when endpoint is up', async () => {
      const service = new CdpUploaderService()
      global.fetch.mockResolvedValue({ ok: true, status: 200 })

      const result = await service.healthCheck()

      expect(result).toMatchObject({ healthy: true, status: 200 })
      expect(global.fetch).toHaveBeenCalledWith(
        'https://uploader.test/health',
        expect.objectContaining({ method: 'GET', timeout: 5000 })
      )
    })

    it('returns unhealthy response when endpoint check throws', async () => {
      const service = new CdpUploaderService()
      global.fetch.mockRejectedValue(new Error('network unavailable'))

      const result = await service.healthCheck()

      expect(result).toMatchObject({
        healthy: false,
        error: 'network unavailable'
      })
    })
  })
})
