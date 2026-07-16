/**
 * Output service used by @defra/forms-engine-plugin to deliver the completed
 * submission to its final destination.
 */
export const outputService = {
  submit(
    context,
    request,
    model,
    emailAddress,
    items,
    submitResponse,
    formMetadata
  ) {
    request.logger.info(
      {
        form: formMetadata?.slug,
        referenceNumber: context.referenceNumber,
        notificationEmail: emailAddress,
        answers: items.map((item) => ({
          name: item.name,
          title: item.title,
          value: item.value
        }))
      },
      'Form submission received'
    )

    return Promise.resolve()
  }
}
