const Comment = require('../models/Comment');

exports.create = async (req, res) => {
  try {
    const { article, name, email, message } = req.body;
    if (!article || !name || !email || !message) {
      return res.status(400).json({ message: 'All fields required' });
    }
    const comment = await Comment.create({ article, name, email, message, status: 'pending' });
    res.status(201).json({ message: 'Comment submitted for review', comment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getForArticle = async (req, res) => {
  try {
    const comments = await Comment.find({ article: req.params.id, status: 'approved' }).sort({ createdAt: -1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const comment = await Comment.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(comment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
