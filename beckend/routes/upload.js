const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const router = express.Router();

// file ko memory mein rakhega (disk pe save nahi karega)
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided' });
    }

    const form = new FormData();
    form.append('image', req.file.buffer.toString('base64'));

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      form,
      { headers: form.getHeaders() }
    );

    const imageUrl = response.data.data.url;
    res.json({ url: imageUrl });
  } catch (err) {
    console.error('ImgBB upload error:', err.response?.data || err.message);
    res.status(500).json({ message: 'Image upload failed' });
  }
});

module.exports = router;
