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
const ALLOWED_EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_VIDEO_MIME_TYPES = ['video/webm', 'video/mp4', 'video/quicktime'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB — short clips, but video encodes much larger than images/PDFs

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

function validateEvidenceFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }
  if (!ALLOWED_EVIDENCE_MIME_TYPES.includes(file.mimetype)) {
    return { valid: false, error: 'Please upload a JPEG, PNG, WebP, or PDF file.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File must be smaller than 5MB.' };
  }
  return { valid: true };
}

function validateVideoFile(file) {
  if (!file) {
    return { valid: false, error: 'No video file provided.' };
  }
  if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.mimetype)) {
    return { valid: false, error: 'Please upload a WebM, MP4, or MOV video.' };
  }
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    return { valid: false, error: 'Video must be smaller than 100MB.' };
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

async function uploadFraudEvidence(reportId, file) {
  const validation = validateEvidenceFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
  const key = `fraud-evidence/${reportId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  const publicUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
  return publicUrl;
}

function videoExtensionFor(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension) return extension;
  if (file.mimetype === 'video/mp4') return '.mp4';
  if (file.mimetype === 'video/quicktime') return '.mov';
  return '.webm';
}

async function uploadRecruiterIntroVideo(recruiterId, file) {
  const validation = validateVideoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = videoExtensionFor(file);
  const key = `recruiter-intro-videos/${recruiterId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
}

async function uploadCandidateIntroVideo(candidateId, file) {
  const validation = validateVideoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = videoExtensionFor(file);
  const key = `candidate-intro-videos/${candidateId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
}

async function uploadCandidateInterviewVideo(candidateId, questionId, file) {
  const validation = validateVideoFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const extension = videoExtensionFor(file);
  const key = `candidate-interview-videos/${candidateId}-q${questionId}-${crypto.randomBytes(6).toString('hex')}${extension}`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  }));

  return `https://${BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`;
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
  uploadFraudEvidence,
  uploadRecruiterIntroVideo,
  uploadCandidateIntroVideo,
  uploadCandidateInterviewVideo,
  deleteS3Object,
  validateImageFile,
  validateResumeFile,
  validateEvidenceFile,
  validateVideoFile
};