const mongoose = require('mongoose');
const AdPlacement = require('../models/AdPlacement');
const Advertisement = require('../models/Advertisement');
const AdSetting = require('../models/AdSetting');

function slugifyKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// No advertiser/campaign fields accepted here on purpose — placements are
// pure slot definitions. If a future payload ever includes advertiser-ish
// keys (e.g. "advertiserId"), this list is what keeps them from silently
// becoming placement fields.
const EDITABLE_FIELDS = ['name', 'description', 'recommendedDimensions', 'device', 'rotationMode', 'fallbackBehavior'];

function validatePayload(body, { partial } = { partial: false }) {
  const errors = [];

  if (!partial) {
    if (!body.name || !String(body.name).trim()) errors.push('name is required');
    if (!body.key || !String(body.key).trim()) errors.push('key is required');
  }

  if (body.device !== undefined && body.device !== '' && !AdPlacement.DEVICES.includes(body.device)) {
    errors.push('device is not a recognized value');
  }
  if (body.rotationMode !== undefined && body.rotationMode !== '' && !AdPlacement.ROTATION_MODES.includes(body.rotationMode)) {
    errors.push('rotationMode is not a recognized value');
  }
  if (body.fallbackBehavior !== undefined && body.fallbackBehavior !== '' && !AdPlacement.FALLBACK_BEHAVIORS.includes(body.fallbackBehavior)) {
    errors.push('fallbackBehavior is not a recognized value');
  }

  return errors;
}

// GET /api/placements?search=&device=&status=
exports.list = async (req, res) => {
  try {
    const { search, device, status } = req.query;
    const filter = {};

    if (device) filter.device = device;
    if (status === 'active') filter.active = true;
    if (status === 'inactive') filter.active = false;

    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { key: re }, { description: re }];
    }

    const placements = await AdPlacement.find(filter).sort({ isDefault: -1, name: 1 });

    // Live "in use" count so the console can warn before a destructive
    // delete, without denormalizing anything onto AdPlacement itself.
    // NOTE: Advertisement.placements is now a many-to-many array (Part
    // 7A-1), so $unwind before grouping — a single ad referencing 3
    // placements should contribute to all 3 counts, not just one.
    const ids = placements.map((p) => p._id);
    const counts = ids.length
      ? await Advertisement.aggregate([
          { $match: { placements: { $in: ids } } },
          { $unwind: '$placements' },
          { $match: { placements: { $in: ids } } },
          { $group: { _id: '$placements', count: { $sum: 1 } } }
        ])
      : [];
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json(placements.map((p) => ({ ...p.toObject(), advertisementCount: countMap.get(String(p._id)) || 0 })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/placements/:id
exports.getOne = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid placement id' });
    }
    const placement = await AdPlacement.findById(req.params.id);
    if (!placement) return res.status(404).json({ message: 'Placement not found' });
    const advertisementCount = await Advertisement.countDocuments({ placements: placement._id });
    res.json({ ...placement.toObject(), advertisementCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/placements
// Covers the (less common) case of an admin defining a placement beyond
// the 9 shipped defaults — same validation and key-stability rules apply.
exports.create = async (req, res) => {
  try {
    const errors = validatePayload(req.body);
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const key = slugifyKey(req.body.key);
    if (!key) return res.status(400).json({ message: 'key must contain at least one letter or number' });

    const existing = await AdPlacement.findOne({ key });
    if (existing) return res.status(409).json({ message: `A placement with key "${key}" already exists` });

    const settings = await AdSetting.findOne({ key: 'global' }).select('defaultRotationMode');
    const defaultRotationMode = settings && AdSetting.ROTATION_MODE_VALUES.includes(settings.defaultRotationMode)
      ? settings.defaultRotationMode : 'priority';
    const placement = await AdPlacement.create({
      name: req.body.name.trim(),
      key,
      description: (req.body.description || '').trim(),
      recommendedDimensions: (req.body.recommendedDimensions || '').trim(),
      device: req.body.device || 'both',
      rotationMode: req.body.rotationMode || defaultRotationMode,
      fallbackBehavior: req.body.fallbackBehavior || 'hide',
      active: req.body.active !== undefined ? !!req.body.active : true,
      isDefault: false
    });

    res.status(201).json(placement);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'A placement with this key already exists' });
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/placements/:id
// Deliberately never touches `key` — placement keys must be stable once
// created, so an incoming `key` in the body is ignored rather than
// erroring, keeping this endpoint safe to call from a form that still has
// the (disabled/read-only) key field present.
exports.update = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid placement id' });
    }
    const placement = await AdPlacement.findById(req.params.id);
    if (!placement) return res.status(404).json({ message: 'Placement not found' });

    const errors = validatePayload(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    EDITABLE_FIELDS.forEach((f) => {
      if (req.body[f] !== undefined) {
        placement[f] = typeof req.body[f] === 'string' ? req.body[f].trim() : req.body[f];
      }
    });

    await placement.save();
    res.json(placement);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/placements/:id/active  { active: true|false }
// Dedicated endpoint for the list-row Enable/Disable quick action.
exports.setActive = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid placement id' });
    }
    if (typeof req.body.active !== 'boolean') {
      return res.status(400).json({ message: 'active must be true or false' });
    }
    const placement = await AdPlacement.findByIdAndUpdate(
      req.params.id,
      { active: req.body.active },
      { new: true }
    );
    if (!placement) return res.status(404).json({ message: 'Placement not found' });
    res.json(placement);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/placements/:id
// Only allowed when no Advertisement references this placement — otherwise
// the safe path is to disable it instead, same "archive where safe"
// pattern used for Advertisers. Default (seeded) placements can still be
// deleted if genuinely unused; isDefault is informational, not a lock.
exports.remove = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid placement id' });
    }
    const inUse = await Advertisement.countDocuments({ placements: req.params.id });
    if (inUse > 0) {
      return res.status(409).json({
        message: `Cannot delete: ${inUse} advertisement(s) reference this placement. Disable it instead to preserve history.`
      });
    }
    const placement = await AdPlacement.findByIdAndDelete(req.params.id);
    if (!placement) return res.status(404).json({ message: 'Placement not found' });
    res.json({ message: 'Placement deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/placements/seed-defaults
// Manual re-run of the same idempotent seed the server performs on
// startup — useful if defaults need restoring without a redeploy.
exports.seedDefaults = async (req, res) => {
  try {
    await AdPlacement.seedDefaults();
    const placements = await AdPlacement.find().sort({ isDefault: -1, name: 1 });
    res.json(placements);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
