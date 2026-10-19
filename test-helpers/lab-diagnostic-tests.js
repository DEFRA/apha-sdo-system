import { testsByKey } from '#/server/routes/diagnostic-tests/qualifying-tests.js'

/**
 * The lab diagnostic tests store mocked so that every lab has defined its
 * diagnostic tests, for tests that open Animal Health Regulations journeys,
 * which are held back until it has. Use as the factory of a vi.mock:
 *
 *   vi.mock(
 *     '#/server/routes/diagnostic-tests/lab-diagnostic-tests.js',
 *     async (importOriginal) =>
 *       (await import('#/test-helpers/lab-diagnostic-tests.js'))
 *         .mockLabDiagnosticTestsDefined(importOriginal)
 *   )
 *
 * getLabDiagnosticTests and saveLabDiagnosticTests are vi.fn, so a test can
 * make a lab undefined with getLabDiagnosticTests.mockResolvedValue(null).
 */
export const DEFINED_LAB_DIAGNOSTIC_TESTS = [
  { test: testsByKey.get('bhv-fat'), accreditation: 'Yes' }
]

export async function mockLabDiagnosticTestsDefined(importOriginal) {
  const original = await importOriginal()

  return {
    ...original,
    getLabDiagnosticTests: vi.fn(async () => DEFINED_LAB_DIAGNOSTIC_TESTS),
    saveLabDiagnosticTests: vi.fn(async () => {})
  }
}
