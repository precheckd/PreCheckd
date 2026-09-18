const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const path = require('path');

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
    return { valid: false, error: 'Please upload a JPEG, PNG, or WebP image.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'Image must be smaller than 5MB.' };
  }
  return { valid: true };
}

function validateResumeFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }
  if (!ALLOWED_RESUME_MIME_TYPES.includes(file.mimetype)) {
    return { valid: false, error: 'Please upload a PDF or DOCX file.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File must be smaller than 5MB.' };
  }
  return { valid: true };
}

async function uploadProfilePhoto(recruiterId, file) {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
  const key = `recruiter-photos/${recruiterId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
  return publicUrl;
}

async function uploadCandidatePhoto(candidateId, file) {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
  const key = `candidate-photos/${candidateId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
  return publicUrl;
}

async function uploadResume(candidateId, file) {
  const validation = validateResumeFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = path.extname(file.originalname).toLowerCase() || '.pdf';
  const key = `candidate-resumes/${candidateId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
  return publicUrl;
}

async function deleteS3Object(fileUrl) {
  if (!fileUrl) return;
  try {
    const key = fileUrl.split(`${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/`)[1];
    if (!key) return;
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
  } catch (error) {
    console.error('Failed to delete old S3 file:', error);
  }
}

module.exports = {
  uploadProfilePhoto,
  uploadCandidatePhoto,
  uploadResume,
  deleteS3Object,
  validateImageFile,
  validateResumeFile
};