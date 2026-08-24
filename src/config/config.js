import convict from 'convict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import convictFormatWithValidator from 'convict-format-with-validator'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const fourHoursMs = 14400000
const oneWeekMs = 604800000

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

convict.addFormats(convictFormatWithValidator)

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT'
  },
  staticCacheTimeout: {
    doc: 'Static cache timeout in milliseconds',
    format: Number,
    default: oneWeekMs,
    env: 'STATIC_CACHE_TIMEOUT'
  },
  serviceName: {
    doc: 'Applications Service Name',
    format: String,
    default: 'apha-sdo-system'
  },
  root: {
    doc: 'Project root',
    format: String,
    default: path.resolve(dirname, '../..')
  },
  assetPath: {
    doc: 'Asset path',
    format: String,
    default: '/public',
    env: 'ASSET_PATH'
  },
  isProduction: {
    doc: 'If this application running in the production environment',
    format: Boolean,
    default: isProduction
  },
  isDevelopment: {
    doc: 'If this application running in the development environment',
    format: Boolean,
    default: isDevelopment
  },
  isTest: {
    doc: 'If this application running in the test environment',
    format: Boolean,
    default: isTest
  },
  log: {
    enabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: process.env.NODE_ENV !== 'test',
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in.',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : [],
      env: 'LOG_REDACT'
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isSecureContextEnabled: {
    doc: 'Enable Secure Context',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_SECURE_CONTEXT'
  },
  session: {
    cache: {
      engine: {
        doc: 'backend cache is written to',
        format: ['redis', 'memory'],
        default: isProduction ? 'redis' : 'memory',
        env: 'SESSION_CACHE_ENGINE'
      },
      name: {
        doc: 'server side session cache name',
        format: String,
        default: 'session',
        env: 'SESSION_CACHE_NAME'
      },
      ttl: {
        doc: 'server side session cache ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_CACHE_TTL'
      }
    },
    cookie: {
      ttl: {
        doc: 'Session cookie ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_COOKIE_TTL'
      },
      password: {
        doc: 'session cookie password',
        format: String,
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'SESSION_COOKIE_PASSWORD',
        sensitive: true
      },
      secure: {
        doc: 'set secure flag on cookie',
        format: Boolean,
        default: isProduction,
        env: 'SESSION_COOKIE_SECURE'
      }
    }
  },
  redis: {
    host: {
      doc: 'Redis cache host',
      format: String,
      default: '127.0.0.1',
      env: 'REDIS_HOST'
    },
    username: {
      doc: 'Redis cache username',
      format: String,
      default: '',
      env: 'REDIS_USERNAME'
    },
    password: {
      doc: 'Redis cache password',
      format: '*',
      default: '',
      sensitive: true,
      env: 'REDIS_PASSWORD'
    },
    keyPrefix: {
      doc: 'Redis cache key prefix name used to isolate the cached results across multiple clients',
      format: String,
      default: 'apha-sdo-system:',
      env: 'REDIS_KEY_PREFIX'
    },
    useSingleInstanceCache: {
      doc: 'Connect to a single instance of redis instead of a cluster.',
      format: Boolean,
      default: !isProduction,
      env: 'USE_SINGLE_INSTANCE_CACHE'
    },
    useTLS: {
      doc: 'Connect to redis using TLS',
      format: Boolean,
      default: isProduction,
      env: 'REDIS_TLS'
    }
  },
  formsEngine: {
    baseUrl: {
      doc: 'Base URL used by @defra/forms-engine-plugin to build absolute links (e.g. save-and-exit and file upload callbacks)',
      format: 'url',
      default: 'http://localhost:3000',
      env: 'FORMS_ENGINE_BASE_URL'
    }
  },
  appBaseUrl: {
    doc: 'Externally visible application base URL used for OIDC redirects',
    format: 'url',
    default: 'http://localhost:3000',
    env: 'APP_BASE_URL'
  },
  auth: {
    entraId: {
      credentialMode: {
        doc: 'How the application authenticates to the Entra token endpoint',
        format: ['mock', 'client-secret', 'web-identity'],
        default: 'mock',
        env: 'AUTH_ENTRA_ID_CREDENTIAL_MODE'
      },
      tenantId: {
        doc: 'Microsoft Entra tenant ID',
        format: String,
        default: '',
        env: 'AUTH_ENTRA_ID_TENANT_ID'
      },
      clientId: {
        doc: 'Microsoft Entra application (client) ID',
        format: String,
        default: 'local-stub-client',
        env: 'AUTH_ENTRA_ID_CLIENT_ID'
      },
      clientSecret: {
        doc: 'Microsoft Entra client secret for client-secret mode',
        format: String,
        default: '',
        env: 'AUTH_ENTRA_ID_CLIENT_SECRET',
        sensitive: true
      },
      discoveryUrl: {
        doc: 'OIDC discovery URL override; derived from tenantId when omitted',
        format: String,
        nullable: true,
        default: null,
        env: 'AUTH_ENTRA_ID_OIDC_CONFIGURATION_URL'
      },
      scopes: {
        doc: 'Space-separated OIDC scopes',
        format: String,
        default: 'openid profile email offline_access',
        env: 'AUTH_ENTRA_ID_SCOPES'
      },
      allowedGroupIds: {
        doc: 'Entra group object IDs allowed to access the service',
        format: Array,
        default: [],
        env: 'AUTH_ENTRA_ID_ALLOWED_GROUP_IDS'
      },
      authorizationMode: {
        doc: 'Whether access is checked by group claims, Entra assignment or tenant only',
        format: ['groups', 'assignment-only', 'tenant-only'],
        default: 'groups',
        env: 'AUTH_ENTRA_ID_AUTHORIZATION_MODE'
      },
      assignmentRequiredConfirmed: {
        doc: 'Confirms Entra Enterprise Application assignment is required',
        format: Boolean,
        default: false,
        env: 'AUTH_ENTRA_ID_ASSIGNMENT_REQUIRED_CONFIRMED'
      },
      tenantWideAccessConfirmed: {
        doc: 'Confirms temporary access for any authenticated user in the configured tenant',
        format: Boolean,
        default: false,
        env: 'AUTH_ENTRA_ID_TENANT_WIDE_ACCESS_CONFIRMED'
      },
      federatedAudience: {
        doc: 'Audience configured on the Entra federated credential',
        format: Array,
        default: ['api://AzureADTokenExchange'],
        env: 'AUTH_ENTRA_ID_FEDERATED_AUDIENCE'
      },
      earlyRefreshMs: {
        doc: 'Refresh access tokens this many milliseconds before expiry',
        format: 'nat',
        default: 300000,
        env: 'AUTH_ENTRA_ID_EARLY_REFRESH_MS'
      }
    }
  },
  azure: {
    // Credentials used for Azure Blob Storage. Interactive user
    // authentication has separate, least-privilege AUTH_ENTRA_ID_* settings.
    identity: {
      tenantId: {
        doc: 'Azure AD tenant ID',
        format: String,
        default: '',
        env: 'AZURE_TENANT_ID'
      },
      clientId: {
        doc: 'Azure AD application (client) ID',
        format: String,
        default: '',
        env: 'AZURE_CLIENT_ID'
      },
      clientSecret: {
        doc: 'Azure AD client secret',
        format: String,
        default: '',
        sensitive: true,
        env: 'AZURE_CLIENT_SECRET'
      }
    },
    storage: {
      enabled: {
        doc: 'Enable transfer of submissions to Azure Blob Storage',
        format: Boolean,
        default: false,
        env: 'AZURE_STORAGE_ENABLED'
      },
      connectionString: {
        doc: 'Azure Storage connection string (local development / Azurite)',
        format: String,
        default: '',
        sensitive: true,
        env: 'AZURE_STORAGE_CONNECTION_STRING'
      },
      accountName: {
        doc: 'Azure Storage account name (used with account key or AAD credential)',
        format: String,
        default: '',
        env: 'AZURE_STORAGE_ACCOUNT_NAME'
      },
      accountKey: {
        doc: 'Azure Storage account key',
        format: String,
        default: '',
        sensitive: true,
        env: 'AZURE_STORAGE_ACCOUNT_KEY'
      },
      containerName: {
        doc: 'Azure Blob container that receives submissions',
        format: String,
        default: 'uploads',
        env: 'AZURE_CONTAINER_NAME'
      }
    }
  },
  cdpUploader: {
    stagingPrefix: {
      doc: 'Key prefix within the scanned-files bucket, used to resolve the conventional S3 location of a scanned file when no scan record is available. Defaults follow the STAGING_PREFIX env var read by @defra/forms-engine-plugin so the two config surfaces cannot drift. Trailing slashes are tolerated.',
      format: String,
      default: `${process.env.STAGING_PREFIX ?? 'staging'}/`,
      env: 'CDP_UPLOADER_STAGING_PREFIX'
    }
  },
  s3: {
    region: {
      doc: 'AWS region for the scanned-files bucket',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    bucket: {
      doc: 'Bucket scanned files are downloaded from (same bucket the cdp-uploader delivers to)',
      format: String,
      default: 'apha-sdo-uploads',
      env: 'UPLOADER_BUCKET_NAME'
    },
    endpoint: {
      doc: 'Custom S3 endpoint (localstack in local development)',
      format: String,
      nullable: true,
      default: null,
      env: 'S3_ENDPOINT'
    }
  },
  nunjucks: {
    watch: {
      doc: 'Reload templates when they are changed.',
      format: Boolean,
      default: isDevelopment
    },
    noCache: {
      doc: 'Use a cache and recompile templates each time',
      format: Boolean,
      default: isDevelopment
    }
  },
  tracing: {
    header: {
      doc: 'Which header to track',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  }
})

config.validate({ allowed: 'strict' })
