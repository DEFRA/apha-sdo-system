import { fileCallbackController } from './controller.js'

export const fileCallback = {
  plugin: {
    name: 'file-callback',
    register(server) {
      server.route({
        method: 'POST',
        path: '/file',
        ...fileCallbackController
      })
    }
  }
}
