import { config } from '#/config/config.js'
import { downloadFromS3 } from '#/server/common/helpers/s3-client.js'
import { azureStorageService } from '#/server/upload/services/azure-storage-service.js'
import { redisUploadStore } from '#/server/services/redis-upload-store.js'
import { reportTypesBySlug } from '../report-types.js'
import {
  reportDateFromState,
  reportMonthYearLabel,
  uploadedFileName
} from '../validation/report-file-name.js'

// Every report journey names its MonthYearField this (see report-journey.js)
const REPORT_DATE_ANSWER_NAME = 'reportDate'

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

// Only files the uploader finished with are transferred, so only those are
// named in submission.json.
function isCompleteFile(fileState) {
  return fileState.status.form?.file?.fileStatus === 'complete'
}

// "March 2024": the value shown for the report date on check your answers.
// Taken from the answer itself so the two can never differ; state is only a
// fallback for a journey that somehow reached submit without that answer.
function reportMonthYearOf(answers, state) {
  return (
    answers.find((answer) => answer.name === REPORT_DATE_ANSWER_NAME)?.value ??
    reportMonthYearLabel(reportDateFromState(state)) ??
    null
  )
}

// A repeated item from the summary details carries its repetitions in
// subItems, each a list of the answers of one repetition
function isRepeatedItem(item) {
  return Array.isArray(item.subItems)
}

// The answers given once, as shown on check your answers
function answersOf(items) {
  return items
    .filter((item) => !isRepeatedItem(item))
    .map((item) => ({
      name: item.name,
      title: item.title,
      value: item.value
    }))
}

// The entries of a web-form report: one object per entry, keyed by answer
// name and holding the answer as given (its `data`, falling back to the
// value shown on check your answers). An answer only appears when its
// question was asked of that entry (otherSpecies is only present when the
// species is "Other").
function entriesOf(items) {
  return items
    .filter(isRepeatedItem)
    .flatMap((item) =>
      item.subItems.map((answers) =>
        Object.fromEntries(
          answers.map((answer) => [answer.name, answer.data ?? answer.value])
        )
      )
    )
}

/**
 * The record written alongside the data files. Its top-level fields are the
 * ones the downstream submissions table is built from: who (userId), for
 * which lab (organisationId), which process (BR/AHR), for which month, and
 * which files. `form` is the journey slug and predates `processName`.
 * `entries` carries the entries of a web-form report and is empty for an
 * uploaded one, so the record has the same shape for every journey.
 */
function buildSubmission({
  referenceNumber,
  formMetadata,
  user,
  answers,
  entries,
  fileStates,
  state,
  emailAddress
}) {
  const fileNames = fileStates
    .filter(isCompleteFile)
    .map(uploadedFileName)
    .filter(Boolean)

  return {
    referenceNumber,
    form: formMetadata?.slug ?? null,
    processName: reportTypesBySlug.get(formMetadata?.slug)?.code ?? null,
    userId: user?.id ?? null,
    organisationId: user?.organisationId ?? null,
    submittedAt: new Date().toISOString(),
    fileName: fileNames.length === 1 ? fileNames[0] : null,
    fileNames,
    reportMonthYear: reportMonthYearOf(answers, state),
    notificationEmail: emailAddress,
    answers,
    entries
  }
}

async function uploadSubmissionJson(submission) {
  const { referenceNumber } = submission

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
 * {referenceNumber}/submission.json holding the form answers and the
 * submission metadata (see buildSubmission).
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
    const fileStates = extractFileStates(context.relevantState)

    const submission = buildSubmission({
      referenceNumber,
      formMetadata,
      user: request.auth?.credentials?.user,
      answers: answersOf(items),
      entries: entriesOf(items),
      fileStates,
      state: context.relevantState,
      emailAddress
    })

    request.logger.info(
      {
        form: submission.form,
        processName: submission.processName,
        referenceNumber,
        userId: submission.userId,
        organisationId: submission.organisationId,
        reportMonthYear: submission.reportMonthYear,
        fileNames: submission.fileNames,
        notificationEmail: emailAddress,
        answers: submission.answers,
        entries: submission.entries.length
      },
      'Form submission received'
    )

    if (!config.get('azure.storage.enabled')) {
      return
    }

    let transferredFiles = 0

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

    await uploadSubmissionJson(submission)

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
