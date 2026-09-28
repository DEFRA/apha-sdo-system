import nunjucks from 'nunjucks'

import { config } from '#/config/config.js'

// The forms engine compiles layouts once. In development that leaves journey
// pages on an old copy of the shared layout after it changes, while the
// service's own pages re-read it. Recompile on each render in development.
if (!config.get('isProduction')) {
  const configure = nunjucks.configure.bind(nunjucks)

  nunjucks.configure = (paths, options = {}) =>
    configure(paths, { noCache: true, ...options })
}
