const mongoose = require('mongoose');
const slugify = require('slugify');
const Advertiser = require('../models/Advertiser');
const Campaign = require('../models/Campaign');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

// Accepts URLs with or without a protocol (e.g. "example.com" or
// "https://example.com") and normalizes to include one, since the console
// form doesn't force the advertiser to type "https://".
function normalizeUrl(raw) {
  if (!raw) return '';
  const trimmed = raw.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).toString();
  } catch (err) {
    return null; // signals "invalid URL" to the caller
  }
}

async function uniqueSlug(base) {
  const root = slugify(base, { lower: true, strict: true }) || 'advertiser';
  let candidate = root;
  let n = 1;
  // Small collections — a loop is fine and keeps this readable.
  // eslint-disable-next-line no-await-in-loop
  while (await Advertiser.exists({ slug: candidate })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

function validatePayload(body, { partial } = { partial: false }) {
  const errors = [];
  const required = ['companyName', 'website', 'contactName', 'email', 'country', 'industry'];

  if (!partial) {
    for (const field of required) {
      if (!body[field] || !String(body[field]).trim()) {
        errors.push(`${field} is required`);
      }
    }
  }

  if (body.email !== undefined && body.email !== '' && !isValidEmail(body.email)) {
    errors.push('email is not a valid email address');
  }

  if (body.industry !== undefined && body.industry !== '' && !Advertiser.INDUSTRIES.includes(body.industry)) {
    errors.push('industry is not a recognized value');
  }

  if (body.status !== undefined && body.status !== '') {
    const allowed = ['pending', 'active', 'inactive', 'blocked', 'archived'];
    if (!allowed.includes(body.status)) errors.push('status is not a recognized value');
  }

  return errors;
}

// Attaches a live campaign count to each advertiser without denormalizing
// it onto the Advertiser document itself (campaigns already know their
// advertiser via Campaign.advertiser, so this stays the single source of
// truth and never drifts out of sync).
async function withCampaignCounts(advertisers) {
  if (!advertisers.length) return [];
  const ids = advertisers.map((a) => a._id);
  const counts = await Campaign.aggregate([
    { $match: { advertiser: { $in: ids } } },
    { $group: { _id: '$advertiser', count: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  return advertisers.map((a) => ({
    ...a.toObject(),
    campaignCount: countMap.get(String(a._id)) || 0
  }));
}

// GET /api/advertisers?search=&status=
exports.list = async (req, res) => {
  try {
    const { search, status } = req.query;
    const filter = {};

    if (status) filter.status = status;

    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { companyName: re },
        { website: re },
        { contactName: re },
        { email: re }
      ];
    }

    const advertisers = await Advertiser.find(filter).sort({ createdAt: -1 });
    const withCounts = await withCampaignCounts(advertisers);
    res.json(withCounts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/advertisers/:id
exports.getOne = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid advertiser id' });
    }
    const advertiser = await Advertiser.findById(req.params.id);
    if (!advertiser) return res.status(404).json({ message: 'Advertiser not found' });
    const [withCount] = await withCampaignCounts([advertiser]);
    res.json(withCount);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/advertisers
exports.create = async (req, res) => {
  try {
    const errors = validatePayload(req.body);
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const website = normalizeUrl(req.body.website);
    if (website === null) return res.status(400).json({ message: 'website is not a valid URL' });

    const email = req.body.email.trim().toLowerCase();

    // Duplicate check: same company website or same contact email already
    // on file. Case-insensitive, app-level (not a hard unique DB
    // constraint) since a single agency can legitimately manage more than
    // one advertiser account under one contact email.
    const dupe = await Advertiser.findOne({
      status: { $ne: 'archived' },
      $or: [{ website }, { email }]
    });
    if (dupe) {
      return res.status(409).json({
        message: `An advertiser with this ${dupe.website === website ? 'website' : 'email'} already exists (${dupe.companyName})`
      });
    }

    const slug = await uniqueSlug(req.body.companyName);

    const advertiser = await Advertiser.create({
      companyName: req.body.companyName.trim(),
      slug,
      website,
      contactName: req.body.contactName.trim(),
      email,
      phone: (req.body.phone || '').trim(),
      country: req.body.country.trim(),
      industry: req.body.industry,
      companyDescription: (req.body.companyDescription || '').trim(),
      internalNotes: (req.body.internalNotes || '').trim(),
      status: req.body.status || 'pending'
    });

    res.status(201).json(advertiser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/advertisers/:id
exports.update = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid advertiser id' });
    }
    const advertiser = await Advertiser.findById(req.params.id);
    if (!advertiser) return res.status(404).json({ message: 'Advertiser not found' });

    const errors = validatePayload(req.body);
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    let website = advertiser.website;
    if (req.body.website !== undefined) {
      website = normalizeUrl(req.body.website);
      if (website === null) return res.status(400).json({ message: 'website is not a valid URL' });
    }

    const email = req.body.email !== undefined ? req.body.email.trim().toLowerCase() : advertiser.email;

    const dupe = await Advertiser.findOne({
      _id: { $ne: advertiser._id },
      status: { $ne: 'archived' },
      $or: [{ website }, { email }]
    });
    if (dupe) {
      return res.status(409).json({
        message: `An advertiser with this ${dupe.website === website ? 'website' : 'email'} already exists (${dupe.companyName})`
      });
    }

    if (req.body.companyName && req.body.companyName.trim() !== advertiser.companyName) {
      advertiser.slug = await uniqueSlug(req.body.companyName);
    }

    const fields = ['companyName', 'contactName', 'phone', 'country', 'industry', 'companyDescription', 'internalNotes', 'status'];
    fields.forEach((f) => {
      if (req.body[f] !== undefined) advertiser[f] = typeof req.body[f] === 'string' ? req.body[f].trim() : req.body[f];
    });
    advertiser.website = website;
    advertiser.email = email;

    await advertiser.save();
    res.json(advertiser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/advertisers/:id/status  { status: 'archived' | 'active' | ... }
// Dedicated endpoint for the list-row quick actions (Archive / Reactivate)
// so the console doesn't have to send a full edit payload just to flip a
// status flag.
exports.updateStatus = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid advertiser id' });
    }
    const allowed = ['pending', 'active', 'inactive', 'blocked', 'archived'];
    if (!allowed.includes(req.body.status)) {
      return res.status(400).json({ message: 'status is not a recognized value' });
    }
    const advertiser = await Advertiser.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!advertiser) return res.status(404).json({ message: 'Advertiser not found' });
    res.json(advertiser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/advertisers/:id
exports.remove = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid advertiser id' });
    }
    const campaignCount = await Campaign.countDocuments({ advertiser: req.params.id });
    if (campaignCount > 0) {
      return res.status(409).json({
        message: `Cannot delete: this advertiser has ${campaignCount} campaign(s) on file. Archive it instead to preserve history.`
      });
    }
    const advertiser = await Advertiser.findByIdAndDelete(req.params.id);
    if (!advertiser) return res.status(404).json({ message: 'Advertiser not found' });
    res.json({ message: 'Advertiser deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/advertisers/meta/industries
// Lets the console populate the Industry <select> from the same list the
// backend validates against, instead of hardcoding it twice.
exports.industries = (req, res) => {
  res.json(Advertiser.INDUSTRIES);
};
