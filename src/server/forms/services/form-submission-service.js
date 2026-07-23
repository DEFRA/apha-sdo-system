import { randomUUID } from 'node:crypto'

/**
 * Form submission service used by @defra/forms-engine-plugin when the user
 * submits from the summary page.
 *
 * NOTE: this is a placeholder implementation. When the cdp-uploader (and
 * onward storage, e.g. Azure) integration is added, this is the seam where
 * uploaded files are persisted and submission data is stored.
 */
export const formSubmissionService = {
  /**
   * Persist files by extending their time-to-live, called by the
   * SummaryPageController before final submission. No file upload pages are
   * enabled yet, so there is nothing to persist.
   * @param {{ fileId: string, initiatedRetrievalKey: string }[]} files
   * @param {string} persistedRetrievalKey
   */
  persistFiles(files, persistedRetrievalKey) {
    return Promise.resolve({
      persistedFiles: files.length,
      persistedRetrievalKey
    })
  },

  /**
   * Store the submission records. The forms-engine-plugin expects a
   * `SubmitResponsePayload` in return; the file IDs it contains reference
   * CSV exports of the answers, which we do not generate yet.
   * @param {import('@defra/forms-model').SubmitPayload} data
   */
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
