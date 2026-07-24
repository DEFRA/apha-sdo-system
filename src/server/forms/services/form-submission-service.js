import { randomUUID } from 'node:crypto'

/**
 * Submission service used by @defra/forms-engine-plugin when the user submits
 * from the summary page. Deliberately a stub: we don't run Defra's
 * forms-submission-api, and scanned files are already in our S3 bucket.
 * This is the seam for onward storage (e.g. Azure Blob) when needed.
 */
export const formSubmissionService = {
  // Called before final submission for each FileUploadField with uploads.
  // The default implementation extends the files' TTL in forms-submission-api.
  persistFiles(files, persistedRetrievalKey) {
    return Promise.resolve({
      persistedFiles: files.length,
      persistedRetrievalKey
    })
  },

  // The plugin expects a SubmitResponsePayload; the file IDs reference CSV
  // exports of the answers, which we don't generate.
  submit(data) {
    return Promise.resolve({
      message: 'Submit completed',
      result: {
        files: {
          main: randomUUID(),
          repeaters: Object.fromEntries(
            data.repeaters.map((repeater) => [repeater.name, randomUUID()])
          )
        }
      }
    })
  }
}
