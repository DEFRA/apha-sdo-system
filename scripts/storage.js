/**
 * Dev utility for inspecting the local docker storage emulators.
 *
 *   npm run storage:check - list the S3 staging bucket (localstack) and the
 *                           Azure submissions container (azurite)
 *   npm run storage:clean - same, then delete everything listed
 *
 * Reads the same .env-backed config as the app, so it shows exactly what the
 * app sees.
 */
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'

import { uploadConfig } from '../src/config/upload-config.js'

const clean = process.argv[2] === 'clean'

async function checkS3StagingBucket() {
  const { bucket, endpoint } = uploadConfig.s3Config

  console.log(`\nS3 staging bucket (${endpoint ?? 'AWS'}): ${bucket}`)

  try {
    const s3 = await uploadConfig.getS3Client()
    const { Contents: objects = [] } = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket })
    )

    if (objects.length === 0) {
      console.log('  (empty)')
      return
    }

    for (const object of objects) {
      console.log(`  ${object.Key} - ${object.Size} bytes`)
    }

    if (clean) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.map(({ Key }) => ({ Key })) }
        })
      )
      console.log(`  deleted ${objects.length} object(s)`)
    }
  } catch (error) {
    console.log(`  unavailable: ${error.message}`)
  }
}

async function checkAzureContainer() {
  const { enabled, containerName } = uploadConfig.azureConfig

  console.log(`\nAzure submissions container: ${containerName}`)

  if (!enabled) {
    console.log('  (AZURE_STORAGE_ENABLED is false, skipping)')
    return
  }

  try {
    const blobService = await uploadConfig.getAzureBlobClient()
    const container = blobService.getContainerClient(containerName)

    if (!(await container.exists())) {
      console.log('  (container not created yet - appears on first submission)')
      return
    }

    const blobs = []
    for await (const blob of container.listBlobsFlat()) {
      blobs.push(blob)
    }

    if (blobs.length === 0) {
      console.log('  (empty)')
      return
    }

    for (const blob of blobs) {
      console.log(`  ${blob.name} - ${blob.properties.contentLength} bytes`)
    }

    if (clean) {
      for (const blob of blobs) {
        await container.deleteBlob(blob.name)
      }
      console.log(`  deleted ${blobs.length} blob(s)`)
    }
  } catch (error) {
    console.log(`  unavailable: ${error.message}`)
  }
}

await checkS3StagingBucket()
await checkAzureContainer()
