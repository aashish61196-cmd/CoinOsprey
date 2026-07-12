const Article = require('../models/Article');
const User = require('../models/User');
const Category = require('../models/Category');
const slugify = require('slugify');

exports.stats = async (req, res) => {
  try {
    const published = await Article.countDocuments({ status: 'published' });
    const drafts = await Article.countDocuments({ status: 'draft' });
    const authors = await User.countDocuments();
    res.json({ published, drafts, authors });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.listCategories = async (req, res) => {
  try {
    const cats = await Category.find().sort({ name: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Name required' });
    const slug = slugify(name, { lower: true, strict: true });
    const cat = await Category.create({ name, slug });
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
