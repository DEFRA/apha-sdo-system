import { config } from '#/config/config.js'
import { downloadFromS3 } from '#/server/common/helpers/s3-client.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import { redisUploadStore } from '#/server/services/redis-upload-store.js'
import { uploadErrorCodes } from '#/server/upload/constants/upload-error-codes.js'
import { buildUploadTransferError } from '#/server/upload/helpers/upload-error-response.js'

// A FileUploadField value in form state is a FileState[]: each entry holds
// the raw cdp-uploader status response, where status.form.file carries
// filename/s3Bucket/s3Key once fileStatus is 'complete'.
function isFileState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.uploadId === 'string' &&
    value.status !== null &&
    typeof value.status === 'object'
  )
}

// Collects FileState entries from form state, including values nested one
// level deep under section names.
export function extractFileStates(state = {}, depth = 0) {
  return Object.values(state).flatMap((value) => {
    if (Array.isArray(value)) {
      return value.filter(isFileState)
    }
    if (value !== null && typeof value === 'object' && depth === 0) {
      return extractFileStates(value, depth + 1)
    }
    return []
  })
}

// The forms-engine validates the cdp-uploader status response with
// stripUnknown before storing it in session state, which drops s3Bucket and
// s3Key. Recover them from the scan-completion callback we recorded in Redis;
// failing that, fall back to the uploader's delivery convention of
// {stagingPrefix}/{uploadId}/{fileId} in the staging bucket.
async function resolveS3Location(file, uploadId, logger) {
  if (file.s3Bucket && file.s3Key) {
    return { s3Bucket: file.s3Bucket, s3Key: file.s3Key }
  }

  const scanRecord = await redisUploadStore.getUpload(file.fileId)

  if (scanRecord?.s3Bucket && scanRecord?.s3Key) {
    return { s3Bucket: scanRecord.s3Bucket, s3Key: scanRecord.s3Key }
  }

  const s3Bucket = config.get('s3.bucket')
  const stagingPrefix = config
    .get('cdpUploader.stagingPrefix')
    .replace(/\/+$/, '')

  const s3Key = `${stagingPrefix}/${uploadId}/${file.fileId}`

  logger.warn(
    { uploadId, fileId: file.fileId, s3Bucket, s3Key },
    'No scan record found for file, using conventional S3 staging location'
  )

  return { s3Bucket, s3Key }
}

async function transferFileToAzure(fileState, referenceNumber, logger) {
  const file = fileState.status.form?.file
  const { uploadId } = fileState

  if (!file || file.fileStatus !== 'complete') {
    return false
  }

  const { fileId, filename, contentType } = file
  const { s3Bucket, s3Key } = await resolveS3Location(file, uploadId, logger)

  try {
    const s3Object = await downloadFromS3(s3Bucket, s3Key)

    const azureResult = await azureStorageService.uploadFile(
      uploadId,
      {
        buffer: s3Object.buffer,
        originalname: filename,
        mimetype: contentType ?? s3Object.contentType,
        size: s3Object.buffer.length
      },
      {
        blobPrefix: referenceNumber,
        originalName: filename,
        contentType: contentType ?? s3Object.contentType,
        type: 'file',
        virusScanStatus: 'clean',
        referenceNumber
      }
    )

    await redisUploadStore.setUpload(uploadId, {
      uploadId,
      fileId,
      filename,
      s3Bucket,
      s3Key,
      referenceNumber,
      status: 'transferred',
      azureBlobName: azureResult.blobName,
      transferredAt: new Date().toISOString()
    })

    logger.info(
      { uploadId, fileId, filename, blobName: azureResult.blobName },
      'File transferred to Azure Blob Storage'
    )

    return true
  } catch (error) {
    await redisUploadStore.setUpload(uploadId, {
      uploadId,
      fileId,
      filename,
      s3Bucket,
      s3Key,
      referenceNumber,
      status: 'transfer_failed',
      transferError: error.message,
      failedAt: new Date().toISOString()
    })

    throw error
  }
}

async function uploadSubmissionJson(
  referenceNumber,
  formSlug,
  answers,
  emailAddress
) {
  const submission = {
    referenceNumber,
    form: formSlug,
    notificationEmail: emailAddress,
    submittedAt: new Date().toISOString(),
    answers
  }

  await azureStorageService.uploadFile(
    `${referenceNumber}-submission`,
    Buffer.from(JSON.stringify(submission, null, 2)),
    {
      blobPrefix: referenceNumber,
      originalName: 'submission.json',
      contentType: 'application/json',
      type: 'submission',
      referenceNumber
    }
  )
}

/**
 * Output service used by @defra/forms-engine-plugin to deliver the completed
 * submission to its final destination.
 *
 * When Azure Blob Storage is enabled, scanned files are copied from the S3
 * staging bucket (where the cdp-uploader delivered them) to the Azure
 * container under {referenceNumber}/{filename}, together with a
 * {referenceNumber}/submission.json holding the form answers.
 */
export const outputService = {
  async submit(
    context,
    request,
    model,
    emailAddress,
    items,
    submitResponse,
    formMetadata
  ) {
    const { referenceNumber } = context

    const answers = items.map((item) => ({
      name: item.name,
      title: item.title,
      value: item.value
    }))

    request.logger.info(
      {
        form: formMetadata?.slug,
        referenceNumber,
        notificationEmail: emailAddress,
        answers
      },
      'Form submission received'
    )

    if (!config.get('azure.storage.enabled')) {
      return
    }

    const fileStates = extractFileStates(context.relevantState)
    let transferredFiles = 0

    try {
      for (const fileState of fileStates) {
        const transferred = await transferFileToAzure(
          fileState,
          referenceNumber,
          request.logger
        )

        if (transferred) {
          transferredFiles += 1
        }
      }

      await uploadSubmissionJson(
        referenceNumber,
        formMetadata?.slug,
        answers,
        emailAddress
      )
    } catch (error) {
      // Raw S3/Azure errors are never shown to the user; this maps them to
      // the one safe message/correlationId rendered on the SSR error page.
      throw buildUploadTransferError({
        errorCode: uploadErrorCodes.UPLOAD_FAILED,
        cause: error,
        logContext: { referenceNumber, form: formMetadata?.slug }
      })
    }

    request.logger.info(
      {
        referenceNumber,
        transferredFiles,
        totalFiles: fileStates.length
      },
      'Submission delivered to Azure Blob Storage'
    )
  }
}
