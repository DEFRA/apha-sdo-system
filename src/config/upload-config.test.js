import {
  BlobServiceClient,
  StorageSharedKeyCredential
} from '@azure/storage-blob'
import { ClientSecretCredential, DefaultAzureCredential } from '@azure/identity'
import { S3Client } from '@aws-sdk/client-s3'

import { config } from '#/config/config.js'
import { UploadConfig } from '#/config/upload-config.js'

vi.mock('@azure/storage-blob', () => {
  const BlobServiceClient = vi.fn()
  BlobServiceClient.fromConnectionString = vi.fn(() => ({
    from: 'connection-string'
  }))
  return {
    BlobServiceClient,
    StorageSharedKeyCredential: vi.fn()
  }
})

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(),
  DefaultAzureCredential: vi.fn()
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}))

const azureDefaults = {
  'azure.storage.enabled': false,
  'azure.storage.connectionString': '',
  'azure.storage.accountName': '',
  'azure.storage.accountKey': '',
  'azure.identity.tenantId': '',
  'azure.identity.clientId': '',
  'azure.identity.clientSecret': '',
  's3.endpoint': null
}

function setConfig(overrides = {}) {
  for (const [key, value] of Object.entries({
    ...azureDefaults,
    ...overrides
  })) {
    config.set(key, value)
  }
}

describe('#UploadConfig', () => {
  afterEach(() => {
    setConfig()
  })

  describe('getAzureBlobClient', () => {
    test('throws when Azure storage is disabled', async () => {
      setConfig()

      await expect(new UploadConfig().getAzureBlobClient()).rejects.toThrow(
        'Azure Blob Storage is not enabled'
      )
    })

    test('uses the connection string when provided', async () => {
      setConfig({
        'azure.storage.enabled': true,
        'azure.storage.connectionString': 'UseDevelopmentStorage=true'
      })

      await new UploadConfig().getAzureBlobClient()

      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(
        'UseDevelopmentStorage=true'
      )
    })

    test('uses a service principal when tenant/client credentials are set', async () => {
      setConfig({
        'azure.storage.enabled': true,
        'azure.identity.tenantId': 'tenant',
        'azure.identity.clientId': 'client',
        'azure.identity.clientSecret': 'secret',
        'azure.storage.accountName': 'myaccount'
      })

      await new UploadConfig().getAzureBlobClient()

      expect(ClientSecretCredential).toHaveBeenCalledWith(
        'tenant',
        'client',
        'secret'
      )
      expect(BlobServiceClient).toHaveBeenCalledWith(
        'https://myaccount.blob.core.windows.net',
        expect.any(ClientSecretCredential)
      )
    })

    test('uses a shared key when account name and key are set', async () => {
      setConfig({
        'azure.storage.enabled': true,
        'azure.storage.accountName': 'myaccount',
        'azure.storage.accountKey': 'key'
      })

      await new UploadConfig().getAzureBlobClient()

      expect(StorageSharedKeyCredential).toHaveBeenCalledWith(
        'myaccount',
        'key'
      )
    })

    test('falls back to DefaultAzureCredential', async () => {
      setConfig({ 'azure.storage.enabled': true })

      await new UploadConfig().getAzureBlobClient()

      expect(DefaultAzureCredential).toHaveBeenCalled()
    })

    test('caches the client between calls', async () => {
      setConfig({
        'azure.storage.enabled': true,
        'azure.storage.connectionString': 'UseDevelopmentStorage=true'
      })

      const uploadConfig = new UploadConfig()
      await uploadConfig.getAzureBlobClient()
      await uploadConfig.getAzureBlobClient()

      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledTimes(1)
    })
  })

  describe('getS3Client', () => {
    test('uses path-style addressing when a custom endpoint is set (localstack)', async () => {
      setConfig({ 's3.endpoint': 'http://localhost:4566' })

      await new UploadConfig().getS3Client()

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'http://localhost:4566',
          forcePathStyle: true
        })
      )
    })

    test('omits the endpoint when none is configured (real AWS)', async () => {
      setConfig()

      await new UploadConfig().getS3Client()

      expect(S3Client).toHaveBeenCalledWith({
        region: config.get('s3.region')
      })
    })
  })

  describe('getCdpUploaderConfig', () => {
    test('exposes the cdp-uploader settings from convict', () => {
      const cdpConfig = new UploadConfig().getCdpUploaderConfig()

      expect(cdpConfig).toEqual({
        url: config.get('cdpUploader.url'),
        bucket: config.get('cdpUploader.bucket'),
        stagingPrefix: config.get('cdpUploader.stagingPrefix'),
        maxFileSize: config.get('cdpUploader.maxFileSize'),
        timeout: config.get('cdpUploader.timeout'),
        retryAttempts: config.get('cdpUploader.retryAttempts'),
        callbackAuthToken: config.get('cdpUploader.callbackAuthToken')
      })
    })
  })
})
