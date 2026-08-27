import { FileUploadPageController } from '@defra/forms-engine-plugin/controllers/FileUploadPageController.js'
import { getCacheService } from '@defra/forms-engine-plugin/engine/helpers.js'

import {
  expectedReportFileName,
  partitionFilesByName,
  reportDateFromState,
  reportFileNameErrorText,
  uploadedFileName
} from '../validation/report-file-name.js'

/**
 * Upload page for a report submission. Files are uploaded by the browser
 * straight to the cdp-uploader, so the only point at which this service sees a
 * file name is when the engine adds the scanned file to state in getState().
 * That is where a file whose name does not include the report date gets turned
 * away, the same way the engine turns away files that carry a virus or the
 * wrong type.
 *
 * rejectMisnamedFiles is also called by the report date and summary pages, so
 * a file cannot survive a change of report date or reach the output service by
 * another route.
 */
export class ReportFileUploadPageController extends FileUploadPageController {
  async getState(request) {
    const state = await super.getState(request)

    const result = await this.rejectMisnamedFiles(request, state)

    return result.state
  }

  /**
   * Removes any uploaded file whose name does not include the report date and
   * flashes a GOV.UK error for each. Returns the files that were turned away so
   * callers can decide where to send the user.
   * @param {object} request - the hapi request
   * @param {object} state - the form state
   */
  async rejectMisnamedFiles(request, state) {
    const reportDate = reportDateFromState(state)
    const expected = expectedReportFileName(reportDate)

    if (!expected) {
      return { state, rejected: [] }
    }

    const { kept, rejected } = partitionFilesByName(
      this.getFilesFromState(state),
      reportDate
    )

    if (!rejected.length) {
      return { state, rejected }
    }

    const uploadState = state.upload?.[this.path]

    if (uploadState) {
      uploadState.files = kept
    }

    state[this.fileUpload.name] = kept

    // setState rather than mergeState: lodash merge cannot shrink an array, so
    // a merged update would leave the rejected files behind.
    await this.setState(request, state)

    flashErrors(
      request,
      this.fileUpload.name,
      rejected.map((file) =>
        reportFileNameErrorText(uploadedFileName(file), expected)
      )
    )

    return { state, rejected }
  }

  getViewModel(request, context, translator) {
    const viewModel = super.getViewModel(request, context, translator)
    const expected = expectedReportFileName(reportDateFromState(context?.state))
    const { formComponent } = viewModel

    // Tell users the naming rule before they choose a file, not just after.
    // Two lines: the date-specific name first, then the accepted file types.
    if (expected && formComponent) {
      const existingHint =
        formComponent.model.hint?.html ?? formComponent.model.hint?.text

      formComponent.model = {
        ...formComponent.model,
        hint: {
          html: [
            `The file name must include ${expected}, for example ${expected}.xlsx or ${expected}-1.xlsx`,
            existingHint
          ]
            .filter(Boolean)
            .join('<br>')
        }
      }
    }

    return viewModel
  }
}

/**
 * Flashes errors against the upload component, which renders them in the error
 * summary and beside the component itself. Adds to the errors the engine has
 * already flashed this request (a virus in the same batch, say) rather than
 * replacing them, because only the first flashed message is ever read back.
 */
function flashErrors(request, name, messages) {
  const cacheService = getCacheService(request.server)
  const flashed = cacheService.getFlash(request)?.errors ?? []

  const errors = messages.map((text) => ({
    path: [name],
    href: `#${name}`,
    name,
    text
  }))

  cacheService.setFlash(request, { errors: flashed.concat(errors) })
}

/**
 * The upload page of a report journey, so the pages either side of it can
 * re-apply the file name rule.
 * @param {{ pages?: object[] }} model - the form model
 */
export function findReportFileUploadPage(model) {
  return model?.pages?.find(
    (page) => page instanceof ReportFileUploadPageController
  )
}
