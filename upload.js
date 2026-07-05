const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ---- Ensure upload directories exist ----
const UPLOAD_ROOT = path.join(__dirname, '..', 'public', 'uploads');
const SUBFOLDERS = ['articles', 'avatars', 'misc'];

SUBFOLDERS.forEach((folder) => {
  const dirPath = path.join(UPLOAD_ROOT, folder);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// ---- Allowed file types ----
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// ---- Dynamic storage: decides subfolder based on route/field ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'misc';

    if (file.fieldname === 'thumbnail' || file.fieldname === 'articleImage') {
      folder = 'articles';
    } else if (file.fieldname === 'avatar') {
      folder = 'avatars';
    }

    cb(null, path.join(UPLOAD_ROOT, folder));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = file.fieldname.replace(/[^a-zA-Z0-9]/g, '');
    cb(null, `${safeName}-${uniqueSuffix}${ext}`);
  },
});

// ---- File filter: only allow images ----
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
      ),
      false
    );
  }
};

// ---- Base multer instance ----
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
  },
});

// ---- Exported middleware variants ----
// Single file upload (e.g. article thumbnail, avatar)
const uploadSingle = (fieldName) => upload.single(fieldName);

// Multiple files, same field (e.g. article gallery images)
const uploadMultiple = (fieldName, maxCount = 5) => upload.array(fieldName, maxCount);

// Multiple fields, different names (e.g. thumbnail + gallery in one form)
const uploadFields = (fieldsConfig) => upload.fields(fieldsConfig);

// ---- Multer error handler (use after routes, or wrap in try/catch) ----
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size allowed is 5MB.',
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded.',
      });
    }
    return res.status(400).json({ success: false, message: err.message });
  }

  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }

  next();
};

// ---- Helper: build a public URL for a stored file ----
const getFileUrl = (req, filePath) => {
  if (!filePath) return null;
  const relativePath = filePath.split('public')[1] || filePath;
  return `${req.protocol}://${req.get('host')}${relativePath.replace(/\\/g, '/')}`;
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  uploadFields,
  handleUploadError,
  getFileUrl,
};
