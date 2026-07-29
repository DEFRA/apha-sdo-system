import { uploadConfig } from '#/config/upload-config.js'

/**
 * Download an object from S3 (the staging bucket the cdp-uploader delivers
 * scanned files to). Uses the shared S3 client from upload-config, which
 * points at localstack in local development.
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<{ buffer: Buffer, contentType?: string, contentLength?: number }>}
 */
export async function downloadFromS3(bucket, key) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3')
  const s3Client = await uploadConfig.getS3Client()

  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  )

  const bytes = await response.Body.transformToByteArray()

  return {
    buffer: Buffer.from(bytes),
    contentType: response.ContentType,
    contentLength: response.ContentLength
  }
}
