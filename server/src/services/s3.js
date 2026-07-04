import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

let _client = null;

export function isS3Enabled() {
  return Boolean((process.env.S3_BUCKET || '').trim());
}

function bucket() {
  return (process.env.S3_BUCKET || '').trim();
}

function region() {
  return (
    process.env.S3_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1'
  );
}

function prefix() {
  return (process.env.S3_PREFIX || 'resumes').replace(/\/$/, '');
}

function getClient() {
  if (!_client) {
    _client = new S3Client({ region: region() });
  }
  return _client;
}

/** Object key for a user's resume PDF. */
export function resumeObjectKey(userId, resumeId) {
  return `${prefix()}/${userId}/${resumeId}.pdf`;
}

export async function putObject(key, body, contentType = 'application/pdf') {
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObjectBuffer(key) {
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  );
  const chunks = [];
  for await (const chunk of res.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key) {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: key })
    );
  } catch (err) {
    // Orphan cleanup should not block the API response.
    console.warn(`[coldMail] S3 delete failed for ${key}:`, err.message);
  }
}
