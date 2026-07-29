import { config } from './config.js'

/**
 * Upload configuration facade.
 *
 * Exposes the same public API as apha-sdo-frontend's upload-config so code
 * migrated from that repo (upload services, upload controller, forms.js)
 * works without import changes, while all values are sourced from the
 * convict config in ./config.js.
 *
 * The Azure and AWS SDKs are imported lazily so that loading this module
 * (and therefore the server) stays fast when no transfer is happening.
 */
export class UploadConfig {
  constructor() {
    this.cdpUploaderConfig = {
      endpoint: config.get('cdpUploader.url')
    }

    this.azureConfig = {
      enabled: config.get('azure.storage.enabled'),
      connectionString: config.get('azure.storage.connectionString'),
      containerName: config.get('azure.storage.containerName'),
      backgroundProcessing: false
    }

    this.s3Config = {
      region: config.get('s3.region'),
      bucket: config.get('s3.bucket'),
      endpoint: config.get('s3.endpoint')
    }

    this.formsEngineConfig = {
      uploadPath: '/upload',
      maxFileSize: config.get('cdpUploader.maxFileSize'),
      uploadDirectory: './uploads',
      allowedFileTypes: ['.csv', '.xls', '.xlsx']
    }

    this._azureBlobClient = null
    this._s3Client = null
  }

  getCdpUploaderConfig() {
    return {
      url: config.get('cdpUploader.url'),
      bucket: config.get('cdpUploader.bucket'),
      stagingPrefix: config.get('cdpUploader.stagingPrefix'),
      maxFileSize: config.get('cdpUploader.maxFileSize'),
      timeout: config.get('cdpUploader.timeout'),
      retryAttempts: config.get('cdpUploader.retryAttempts'),
      callbackAuthToken: config.get('cdpUploader.callbackAuthToken')
    }
  }

  /**
   * Get a cached Azure BlobServiceClient.
   *
   * Credential precedence (mirrors the original app):
   * 1. Connection string (local development / Azurite)
   * 2. Service principal (tenant + client id + client secret)
   * 3. Storage account shared key
   * 4. DefaultAzureCredential (managed identity)
   */
  async getAzureBlobClient() {
    if (!this.azureConfig.enabled) {
      throw new Error('Azure Blob Storage is not enabled')
    }

    if (this._azureBlobClient) {
      return this._azureBlobClient
    }

    const { BlobServiceClient, StorageSharedKeyCredential } =
      await import('@azure/storage-blob')

    const { connectionString } = this.azureConfig
    if (connectionString) {
      this._azureBlobClient =
        BlobServiceClient.fromConnectionString(connectionString)
      return this._azureBlobClient
    }

    const tenantId = config.get('azure.identity.tenantId')
    const clientId = config.get('azure.identity.clientId')
    const clientSecret = config.get('azure.identity.clientSecret')
    const accountName = config.get('azure.storage.accountName')
    const accountKey = config.get('azure.storage.accountKey')

    let credential
    if (tenantId && clientId && clientSecret) {
      const { ClientSecretCredential } = await import('@azure/identity')
      credential = new ClientSecretCredential(tenantId, clientId, clientSecret)
    } else if (accountName && accountKey) {
      credential = new StorageSharedKeyCredential(accountName, accountKey)
    } else {
      const { DefaultAzureCredential } = await import('@azure/identity')
      credential = new DefaultAzureCredential()
    }

    const accountUrl = `https://${accountName || 'default'}.blob.core.windows.net`
    this._azureBlobClient = new BlobServiceClient(accountUrl, credential)

    return this._azureBlobClient
  }

  async getS3Client() {
    if (this._s3Client) {
      return this._s3Client
    }

    const { S3Client } = await import('@aws-sdk/client-s3')

    const endpoint = this.s3Config.endpoint

    this._s3Client = new S3Client({
      region: this.s3Config.region,
      ...(endpoint && {
        endpoint,
        // localstack requires path-style bucket addressing
        forcePathStyle: true
      })
    })

    return this._s3Client
  }

  getFormsEngineConfig() {
    return {
      uploadPath: this.formsEngineConfig.uploadPath,
      maxFileSize: this.formsEngineConfig.maxFileSize,
      allowedFileTypes: this.formsEngineConfig.allowedFileTypes,
      uploadDirectory: this.formsEngineConfig.uploadDirectory
    }
  }
}

export const uploadConfig = new UploadConfig()
