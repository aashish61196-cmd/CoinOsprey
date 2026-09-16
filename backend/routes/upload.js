const express = require('express');
const multer = require('multer');
const router = express.Router();
const { uploadBufferToImgbb } = require('../utils/mediaUpload');

// file ko memory mein rakhega (disk pe save nahi karega)
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided' });
    }

    const imageUrl = await uploadBufferToImgbb(req.file.buffer, req.file.originalname);
    res.json({ url: imageUrl });
  } catch (err) {
    console.error('ImgBB upload error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Image upload failed' });
  }
});

module.exports = router;
