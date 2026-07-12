const Subscriber = require('../models/Subscriber');

exports.subscribe = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });
    const existing = await Subscriber.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(200).json({ message: 'Already subscribed' });
    await Subscriber.create({ email: email.toLowerCase() });
    res.status(201).json({ message: 'Subscribed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.unsubscribe = async (req, res) => {
  try {
    const { email } = req.query;
    await Subscriber.findOneAndUpdate({ email: (email || '').toLowerCase() }, { active: false });
    res.send('You have been unsubscribed.');
  } catch (err) {
    res.status(500).send('Error unsubscribing');
  }
};

exports.listSubscribers = async (req, res) => {
  try {
    const subs = await Subscriber.find().sort({ subscribedAt: -1 });
    res.json(subs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
