import { config } from './config.js'

/**
 * Storage client factory for the S3-to-Azure submission transfer.
 *
 * Values are sourced from the convict config in ./config.js. The Azure and
 * AWS SDKs are imported lazily so that loading this module (and therefore
 * the server) stays fast when no transfer is happening.
 */
export class UploadConfig {
  constructor() {
    this.azureConfig = {
      enabled: config.get('azure.storage.enabled'),
      connectionString: config.get('azure.storage.connectionString'),
      containerName: config.get('azure.storage.containerName')
    }

    this.s3Config = {
      region: config.get('s3.region'),
      bucket: config.get('s3.bucket'),
      endpoint: config.get('s3.endpoint')
    }

    this._azureBlobClient = null
    this._s3Client = null
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
}

export const uploadConfig = new UploadConfig()
