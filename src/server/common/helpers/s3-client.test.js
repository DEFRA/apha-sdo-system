import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetS3Client, mockSend } = vi.hoisted(() => {
  const mockSend = vi.fn()
  const mockGetS3Client = vi.fn().mockResolvedValue({ send: mockSend })
  return { mockGetS3Client, mockSend }
})

vi.mock('#/config/upload-config.js', () => ({
  uploadConfig: {
    getS3Client: mockGetS3Client
  }
}))

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(input) {
      this.input = input
    }
  }
}))

describe('downloadFromS3', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockGetS3Client.mockResolvedValue({ send: mockSend })
  })

  it('returns buffer, contentType and contentLength on success', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    mockSend.mockResolvedValue({
      Body: { transformToByteArray: async () => bytes },
      ContentType: 'text/csv',
      ContentLength: 3
    })

    const { downloadFromS3 } = await import('./s3-client.js')
    const result = await downloadFromS3('my-bucket', 'path/to/file.csv')

    expect(result).toEqual({
      buffer: Buffer.from(bytes),
      contentType: 'text/csv',
      contentLength: 3
    })
    expect(mockGetS3Client).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'my-bucket', Key: 'path/to/file.csv' }
      })
    )
  })

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('S3 unavailable'))

    const { downloadFromS3 } = await import('./s3-client.js')

    await expect(downloadFromS3('my-bucket', 'missing.csv')).rejects.toThrow(
      'S3 unavailable'
    )
  })
})
