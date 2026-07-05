const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.join(__dirname, "..", "public", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(10).toString("hex");
    cb(null, `${Date.now()}-${unique}${ext}`);
  },
});

const allowedTypes = /jpeg|jpg|png|webp|gif|svg/;

function fileFilter(req, file, cb) {
  const extOk = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = allowedTypes.test(file.mimetype);
  if (extOk && mimeOk) return cb(null, true);
  cb(new Error("Only image files (jpg, png, webp, gif, svg) are allowed."));
}

const maxSizeMb = Number(process.env.MAX_UPLOAD_MB || 5);

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxSizeMb * 1024 * 1024 },
});

module.exports = upload;
