import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { azureStorageService } from './azure-storage-service.js'

const { mockGetAzureBlobClient, mockAzureConfig } = vi.hoisted(() => ({
  mockGetAzureBlobClient: vi.fn(),
  mockAzureConfig: {
    enabled: true,
    containerName: 'test-container',
    backgroundProcessing: false
  }
}))

vi.mock('../../../config/upload-config.js', () => ({
  uploadConfig: {
    azureConfig: mockAzureConfig,
    getAzureBlobClient: mockGetAzureBlobClient
  }
}))

vi.mock('@azure/storage-blob')

function createMockBlobServiceClient(overrides = {}) {
  const blockBlobClient = {
    upload: vi.fn().mockResolvedValue({
      etag: 'etag-123',
      lastModified: new Date('2026-07-28T09:00:00.000Z')
    }),
    download: vi.fn().mockResolvedValue({
      readableStreamBody: 'stream-body',
      contentType: 'text/csv',
      contentLength: 12,
      lastModified: new Date('2026-07-28T09:00:00.000Z'),
      metadata: { uploadId: 'upload-1' }
    }),
    exists: vi.fn().mockResolvedValue(true),
    deleteIfExists: vi.fn().mockResolvedValue({ succeeded: true }),
    getProperties: vi.fn().mockResolvedValue({ metadata: { existing: 'yes' } }),
    setMetadata: vi.fn().mockResolvedValue(undefined),
    url: 'https://test.blob.core.windows.net/test-container/test-file'
  }

  const containerClient = {
    createIfNotExists: vi.fn().mockResolvedValue({ succeeded: true }),
    getBlockBlobClient: vi.fn().mockReturnValue(blockBlobClient),
    listBlobsFlat: vi.fn().mockReturnValue(createBlobIterator([]))
  }

  const blobServiceClient = {
    getContainerClient: vi.fn().mockReturnValue(containerClient)
  }

  Object.assign(blockBlobClient, overrides.blockBlobClient)
  Object.assign(containerClient, overrides.containerClient)
  Object.assign(blobServiceClient, overrides.blobServiceClient)

  return { blobServiceClient, containerClient, blockBlobClient }
}

async function* createBlobIterator(blobs) {
  for (const blob of blobs) {
    yield blob
  }
}

describe('azureStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAzureBlobClient.mockReset()
    mockAzureConfig.enabled = true
    mockAzureConfig.containerName = 'test-container'
    mockAzureConfig.backgroundProcessing = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('uploadFile', () => {
    it('throws when Azure Blob Storage is disabled', async () => {
      mockAzureConfig.enabled = false

      await expect(
        azureStorageService.uploadFile('upload-1', Buffer.from('test'))
      ).rejects.toThrow('Azure Blob Storage is not enabled')
    })

    it('uploads using file.buffer and private container access', async () => {
      const uploadId = 'upload-1'
      const file = {
        originalname: 'test.xlsx',
        buffer: Buffer.from('test content'),
        mimetype:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
      const metadata = { uploadedBy: 'test-user' }
      const { blobServiceClient, containerClient, blockBlobClient } =
        createMockBlobServiceClient({
          blockBlobClient: {
            url: 'https://test.blob.core.windows.net/test-container/test.xlsx'
          }
        })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.uploadFile(
        uploadId,
        file,
        metadata
      )

      expect(blobServiceClient.getContainerClient).toHaveBeenCalledWith(
        'test-container'
      )
      expect(containerClient.createIfNotExists).toHaveBeenCalledWith()
      expect(blockBlobClient.upload).toHaveBeenCalledWith(
        file.buffer,
        file.buffer.length,
        expect.objectContaining({
          blobHTTPHeaders: {
            blobContentType: file.mimetype
          },
          metadata: expect.objectContaining({
            uploadId,
            originalName: file.originalname,
            uploadedBy: metadata.uploadedBy,
            type: 'file'
          })
        })
      )
      expect(result).toMatchObject({
        success: true,
        uploadId,
        blobName: file.originalname,
        url: 'https://test.blob.core.windows.net/test-container/test.xlsx',
        plainUrl:
          'https://test.blob.core.windows.net/test-container/test.xlsx',
        size: file.buffer.length,
        contentType: file.mimetype
      })
    })

    it('prefers metadata originalName and contentType over file values', async () => {
      const { blobServiceClient, containerClient, blockBlobClient } =
        createMockBlobServiceClient()
      const file = {
        originalname: 'ignored.csv',
        buffer: Buffer.from('data'),
        mimetype: 'text/plain'
      }

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await azureStorageService.uploadFile('upload-2', file, {
        originalName: 'preferred.json',
        contentType: 'application/json',
        type: 'form-data'
      })

      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith(
        'preferred.json'
      )
      expect(blockBlobClient.upload).toHaveBeenCalledWith(
        file.buffer,
        file.buffer.length,
        expect.objectContaining({
          blobHTTPHeaders: {
            blobContentType: 'application/json'
          },
          metadata: expect.objectContaining({
            originalName: 'preferred.json',
            type: 'form-data'
          })
        })
      )
    })

    it('uses hapi filename and content-type when standard properties are missing', async () => {
      const { blobServiceClient, containerClient } = createMockBlobServiceClient()
      const file = {
        _data: Buffer.from('csv,data'),
        hapi: {
          filename: 'from-hapi.csv',
          headers: {
            'content-type': 'text/csv'
          }
        }
      }

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.uploadFile('upload-3', file)

      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith(
        'from-hapi.csv'
      )
      expect(result).toMatchObject({
        blobName: 'from-hapi.csv',
        contentType: 'text/csv'
      })
    })

    it('uploads a raw Buffer input', async () => {
      const { blobServiceClient, blockBlobClient } = createMockBlobServiceClient()
      const file = Buffer.from('raw-bytes')

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.uploadFile('upload-4', file, {
        originalName: 'raw.bin',
        contentType: 'application/octet-stream'
      })

      expect(blockBlobClient.upload).toHaveBeenCalledWith(
        file,
        file.length,
        expect.any(Object)
      )
      expect(result).toMatchObject({
        blobName: 'raw.bin',
        contentType: 'application/octet-stream'
      })
    })

    it('uploads a stream-like input using streamToBuffer', async () => {
      const { blobServiceClient, blockBlobClient } = createMockBlobServiceClient()
      const streamLikeFile = {
        on: vi.fn()
      }
      const streamToBufferSpy = vi
        .spyOn(azureStorageService, 'streamToBuffer')
        .mockResolvedValue(Buffer.from('stream data'))

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.uploadFile(
        'upload-5',
        streamLikeFile,
        {
          originalName: 'stream.txt',
          contentType: 'text/plain'
        }
      )

      expect(streamToBufferSpy).toHaveBeenCalledWith(streamLikeFile)
      expect(blockBlobClient.upload).toHaveBeenCalledWith(
        Buffer.from('stream data'),
        Buffer.from('stream data').length,
        expect.any(Object)
      )
      expect(result.blobName).toBe('stream.txt')

      streamToBufferSpy.mockRestore()
    })

    it('wraps invalid file input errors', async () => {
      const { blobServiceClient } = createMockBlobServiceClient()

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.uploadFile('upload-6', { originalname: 'bad.txt' })
      ).rejects.toThrow('Azure upload failed: Invalid file input type')
    })

    it('wraps Azure upload client errors', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          upload: vi.fn().mockRejectedValue(new Error('network boom'))
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.uploadFile('upload-7', Buffer.from('x'), {
          originalName: 'failure.txt'
        })
      ).rejects.toThrow('Azure upload failed: network boom')
    })
  })

  describe('disabled guards', () => {
    it.each([
      ['downloadFile', () => azureStorageService.downloadFile('upload-1', 'a.txt')],
      [
        'generateSasUrl',
        () => azureStorageService.generateSasUrl('upload-1', 'a.txt')
      ],
      ['listFiles', () => azureStorageService.listFiles()],
      ['deleteFile', () => azureStorageService.deleteFile('upload-1', 'a.txt')],
      ['getContainerStats', () => azureStorageService.getContainerStats()]
    ])('throws when Azure is disabled for %s', async (_, action) => {
      mockAzureConfig.enabled = false

      await expect(action()).rejects.toThrow('Azure Blob Storage is not enabled')
    })
  })

  describe('downloadFile', () => {
    it('returns download details for an existing file', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          download: vi.fn().mockResolvedValue({
            readableStreamBody: 'download-stream',
            contentType: 'application/json',
            contentLength: 42,
            lastModified: new Date('2026-07-28T10:00:00.000Z'),
            metadata: { kind: 'form-data' }
          })
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.downloadFile('upload-8', 'a.json')

      expect(result).toEqual({
        success: true,
        stream: 'download-stream',
        contentType: 'application/json',
        contentLength: 42,
        lastModified: new Date('2026-07-28T10:00:00.000Z'),
        metadata: { kind: 'form-data' }
      })
    })

    it('returns not found for a 404 download error', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          download: vi.fn().mockRejectedValue({ statusCode: 404 })
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.downloadFile('upload-9', 'missing.txt')
      ).resolves.toEqual({ success: false, error: 'File not found' })
    })

    it('wraps non-404 download errors', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          download: vi.fn().mockRejectedValue(new Error('download failed'))
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.downloadFile('upload-10', 'broken.txt')
      ).rejects.toThrow('Azure download failed: download failed')
    })
  })

  describe('generateSasUrl', () => {
    it('returns a URL when the blob exists', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          exists: vi.fn().mockResolvedValue(true),
          url: 'https://test.blob.core.windows.net/test-container/file.txt'
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.generateSasUrl('upload-11', 'file.txt')
      ).resolves.toEqual({
        success: true,
        sasUrl: 'https://test.blob.core.windows.net/test-container/file.txt',
        url: 'https://test.blob.core.windows.net/test-container/file.txt'
      })
    })

    it('wraps missing blob errors', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          exists: vi.fn().mockResolvedValue(false)
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.generateSasUrl('upload-12', 'missing.txt')
      ).rejects.toThrow('URL generation failed: File not found')
    })
  })

  describe('listFiles', () => {
    it('lists files and passes the prefix to Azure', async () => {
      const blobs = [
        {
          name: 'folder/a.csv',
          properties: {
            contentLength: 12,
            lastModified: new Date('2026-07-28T10:00:00.000Z'),
            contentType: 'text/csv',
            etag: 'etag-a'
          },
          metadata: { type: 'spreadsheet' }
        },
        {
          name: 'folder/b.json',
          properties: {
            contentLength: 18,
            lastModified: new Date('2026-07-28T10:10:00.000Z'),
            contentType: 'application/json',
            etag: 'etag-b'
          },
          metadata: { type: 'form-data' }
        }
      ]
      const { blobServiceClient, containerClient } = createMockBlobServiceClient({
        containerClient: {
          listBlobsFlat: vi.fn().mockReturnValue(createBlobIterator(blobs))
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.listFiles('folder/')

      expect(containerClient.listBlobsFlat).toHaveBeenCalledWith({
        prefix: 'folder/'
      })
      expect(result).toEqual({
        success: true,
        files: [
          {
            name: 'folder/a.csv',
            size: 12,
            lastModified: new Date('2026-07-28T10:00:00.000Z'),
            contentType: 'text/csv',
            etag: 'etag-a',
            metadata: { type: 'spreadsheet' }
          },
          {
            name: 'folder/b.json',
            size: 18,
            lastModified: new Date('2026-07-28T10:10:00.000Z'),
            contentType: 'application/json',
            etag: 'etag-b',
            metadata: { type: 'form-data' }
          }
        ],
        count: 2
      })
    })

    it('wraps list failures', async () => {
      const { blobServiceClient, containerClient } = createMockBlobServiceClient({
        containerClient: {
          listBlobsFlat: vi.fn().mockImplementation(() => {
            throw new Error('list failed')
          })
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(azureStorageService.listFiles()).rejects.toThrow(
        'List files failed: list failed'
      )

      expect(containerClient.listBlobsFlat).toHaveBeenCalledWith({})
    })
  })

  describe('deleteFile', () => {
    it('returns the delete result', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          deleteIfExists: vi.fn().mockResolvedValue({ succeeded: false })
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.deleteFile('upload-13', 'stale.txt')
      ).resolves.toEqual({
        success: false,
        deleted: false
      })
    })

    it('wraps delete errors', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        blockBlobClient: {
          deleteIfExists: vi.fn().mockRejectedValue(new Error('delete failed'))
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(
        azureStorageService.deleteFile('upload-14', 'broken.txt')
      ).rejects.toThrow('Azure delete failed: delete failed')
    })
  })

  describe('getContainerStats', () => {
    it('aggregates blob counts and sizes', async () => {
      const blobs = [
        { properties: { contentLength: 1024 } },
        { properties: { contentLength: 2048 } },
        { properties: { contentLength: 0 } }
      ]
      const { blobServiceClient } = createMockBlobServiceClient({
        containerClient: {
          listBlobsFlat: vi.fn().mockReturnValue(createBlobIterator(blobs))
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(azureStorageService.getContainerStats()).resolves.toEqual({
        success: true,
        containerName: 'test-container',
        totalFiles: 3,
        totalSize: 3072,
        totalSizeFormatted: '3 KB'
      })
    })

    it('wraps stats errors', async () => {
      const { blobServiceClient } = createMockBlobServiceClient({
        containerClient: {
          listBlobsFlat: vi.fn().mockImplementation(() => {
            throw new Error('stats failed')
          })
        }
      })

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      await expect(azureStorageService.getContainerStats()).rejects.toThrow(
        'Get container stats failed: stats failed'
      )
    })
  })

  describe('processFileInBackground', () => {
    it('returns a disabled response when background processing is off', async () => {
      mockAzureConfig.backgroundProcessing = false

      await expect(
        azureStorageService.processFileInBackground('upload-15', 'file.txt')
      ).resolves.toEqual({
        success: false,
        message: 'Background processing is disabled'
      })
    })

    it('schedules metadata updates when background processing is enabled', async () => {
      vi.useFakeTimers()
      mockAzureConfig.backgroundProcessing = true

      const { blobServiceClient, blockBlobClient } = createMockBlobServiceClient()

      mockGetAzureBlobClient.mockResolvedValue(blobServiceClient)

      const result = await azureStorageService.processFileInBackground(
        'upload-16',
        'file.txt',
        'convert'
      )

      expect(result).toEqual({
        success: true,
        message: 'Background processing started',
        processingType: 'convert',
        estimatedCompletionTime: '1-2 minutes'
      })

      await vi.advanceTimersByTimeAsync(1000)

      expect(blockBlobClient.getProperties).toHaveBeenCalled()
      expect(blockBlobClient.setMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          existing: 'yes',
          processed: 'true',
          processingType: 'convert'
        })
      )
    })

    it('logs background processing failures', async () => {
      vi.useFakeTimers()
      mockAzureConfig.backgroundProcessing = true

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      mockGetAzureBlobClient.mockRejectedValue(new Error('background broke'))

      await azureStorageService.processFileInBackground('upload-17', 'file.txt')
      await vi.advanceTimersByTimeAsync(1000)

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Background processing failed:',
        {
          message: 'background broke',
          uploadId: 'upload-17'
        }
      )
    })
  })

  describe('streamToBuffer', () => {
    it('combines stream chunks into a buffer', async () => {
      const stream = new EventEmitter()
      const promise = azureStorageService.streamToBuffer(stream)

      process.nextTick(() => {
        stream.emit('data', Buffer.from('hello '))
        stream.emit('data', Buffer.from('world'))
        stream.emit('end')
      })

      await expect(promise).resolves.toEqual(Buffer.from('hello world'))
    })

    it('rejects when the stream errors', async () => {
      const stream = new EventEmitter()
      const promise = azureStorageService.streamToBuffer(stream)

      process.nextTick(() => {
        stream.emit('error', new Error('stream failed'))
      })

      await expect(promise).rejects.toThrow('stream failed')
    })
  })

  describe('formatBytes', () => {
    it('formats zero bytes', () => {
      expect(azureStorageService.formatBytes(0)).toBe('0 Bytes')
    })

    it('formats kilobytes and megabytes', () => {
      expect(azureStorageService.formatBytes(1024)).toBe('1 KB')
      expect(azureStorageService.formatBytes(1048576)).toBe('1 MB')
    })

    it('normalises negative decimals to zero', () => {
      expect(azureStorageService.formatBytes(1536, -1)).toBe('2 KB')
    })
  })
})
