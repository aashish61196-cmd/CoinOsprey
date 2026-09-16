const mongoose = require('mongoose');
const AdCreative = require('../models/AdCreative');
const AdPlacement = require('../models/AdPlacement');
const Advertisement = require('../models/Advertisement');
const AdSetting = require('../models/AdSetting');
const Campaign = require('../models/Campaign');
const { uploadBufferToImgbb } = require('../utils/mediaUpload');
const { validateCreativeFile, parseFixedDimensions } = require('../utils/creativeValidation');

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

const AdAuditLog = require('../models/AdAuditLog');

async function writeAudit({ entityId, action, performedBy, changes = {}, notes = '' }) {
  try {
    await AdAuditLog.create({ entityType: 'AdCreative', entityId, action, performedBy, changes, notes });
  } catch (err) {
    // Audit must never break a successful creative upload/replacement.
    console.error('AdAuditLog write failed:', err.message);
  }
}

// Given multer's req.files (upload.fields shape) and an optional placement
// doc, validate whatever desktop/mobile files were sent and upload the
// ones that pass. Reused by both create() and replace() so the two
// endpoints can never drift in what they accept.
async function processIncomingAssets(files, placementDoc) {
  const settings = await AdSetting.findOne({ key: 'global' }).select('safety');
  const policy = settings && settings.safety ? settings.safety : {};
  const fixed = placementDoc ? parseFixedDimensions(placementDoc.recommendedDimensions) : null;
  const result = {};

  const desktopFile = files && files.desktopImage && files.desktopImage[0];
  const mobileFile = files && files.mobileImage && files.mobileImage[0];

  if (desktopFile) {
    const validated = validateCreativeFile(desktopFile.buffer, desktopFile.originalname, {
      label: 'Desktop creative',
      policy,
      // Only enforce fixed pixel dimensions for placements whose device
      // scope actually includes desktop.
      ...(fixed && placementDoc.device !== 'mobile'
        ? { requireWidth: fixed.width, requireHeight: fixed.height }
        : {})
    });
    const fileUrl = await uploadBufferToImgbb(validated.buffer, desktopFile.originalname);
    result.desktop = {
      fileUrl,
      width: validated.width,
      height: validated.height,
      mimeType: validated.mimeType,
      fileSizeBytes: validated.fileSizeBytes
    };
  }

  if (mobileFile) {
    const validated = validateCreativeFile(mobileFile.buffer, mobileFile.originalname, {
      label: 'Mobile creative',
      policy,
      ...(fixed && placementDoc.device !== 'desktop'
        ? { requireWidth: fixed.width, requireHeight: fixed.height }
        : {})
    });
    const fileUrl = await uploadBufferToImgbb(validated.buffer, mobileFile.originalname);
    result.mobile = {
      fileUrl,
      width: validated.width,
      height: validated.height,
      mimeType: validated.mimeType,
      fileSizeBytes: validated.fileSizeBytes
    };
  }

  return result;
}

// GET /api/creatives?search=&status=&campaign=&advertisement=&unassigned=true
exports.list = async (req, res) => {
  try {
    const { search, status, campaign, advertisement, unassigned } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (campaign && isValidId(campaign)) filter.campaign = campaign;
    if (advertisement && isValidId(advertisement)) filter.advertisements = advertisement;
    if (unassigned === 'true') {
      filter.campaign = null;
      filter.advertisements = { $size: 0 };
    }
    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: re }, { altText: re }];
    }

    const creatives = await AdCreative.find(filter)
      .populate('campaign', 'name campaignCode')
      .populate('advertisements', 'name status')
      .populate('placement', 'name key')
      .sort({ createdAt: -1 });

    res.json(creatives);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/creatives/:id
exports.getOne = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid creative id' });
    const creative = await AdCreative.findById(req.params.id)
      .populate('campaign', 'name campaignCode')
      .populate('advertisements', 'name status')
      .populate('placement', 'name key recommendedDimensions device');
    if (!creative) return res.status(404).json({ message: 'Creative not found' });
    res.json(creative);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/creatives  (multipart: name, altText, placement?, campaign?, desktopImage?, mobileImage?)
// At least one of desktopImage / mobileImage is required. Both go through
// the same MIME/size/dimension validation before ever reaching ImgBB.
exports.create = async (req, res) => {
  try {
    const { name, altText, placement: placementId, campaign: campaignId } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'name is required' });
    }

    const hasDesktop = req.files && req.files.desktopImage && req.files.desktopImage[0];
    const hasMobile = req.files && req.files.mobileImage && req.files.mobileImage[0];
    if (!hasDesktop && !hasMobile) {
      return res.status(400).json({ message: 'Upload at least a desktop or mobile creative file' });
    }

    let placementDoc = null;
    if (placementId) {
      if (!isValidId(placementId)) return res.status(400).json({ message: 'Invalid placement id' });
      placementDoc = await AdPlacement.findById(placementId);
      if (!placementDoc) return res.status(404).json({ message: 'Placement not found' });
    }

    let campaignDoc = null;
    if (campaignId) {
      if (!isValidId(campaignId)) return res.status(400).json({ message: 'Invalid campaign id' });
      campaignDoc = await Campaign.findById(campaignId);
      if (!campaignDoc) return res.status(404).json({ message: 'Campaign not found' });
    }

    const assets = await processIncomingAssets(req.files, placementDoc);

    const creative = await AdCreative.create({
      name: name.trim(),
      altText: (altText || '').trim(),
      placement: placementDoc ? placementDoc._id : null,
      campaign: campaignDoc ? campaignDoc._id : null,
      desktop: assets.desktop || {},
      mobile: assets.mobile || {},
      status: 'active',
      uploadedBy: req.user ? req.user._id : undefined
    });

    await writeAudit({
      entityId: creative._id,
      action: 'creative_upload',
      performedBy: req.user._id,
      changes: {
        name: creative.name,
        placement: creative.placement,
        campaign: creative.campaign,
        desktop: creative.desktop ? { width: creative.desktop.width, height: creative.desktop.height, mimeType: creative.desktop.mimeType, fileSizeBytes: creative.desktop.fileSizeBytes } : null,
        mobile: creative.mobile ? { width: creative.mobile.width, height: creative.mobile.height, mimeType: creative.mobile.mimeType, fileSizeBytes: creative.mobile.fileSizeBytes } : null
      },
      notes: 'Creative uploaded'
    });

    res.status(201).json(creative);
  } catch (err) {
    // validateCreativeFile throws plain Errors with user-facing messages —
    // surface those as 400s rather than a generic 500.
    const status = /unsupported|too large|dimensions|empty file|SVG rejected|requires exactly/i.test(err.message) ? 400 : 500;
    res.status(status).json({ message: err.message });
  }
};

// PUT /api/creatives/:id  (metadata only: name, altText, status)
exports.update = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid creative id' });
    const creative = await AdCreative.findById(req.params.id);
    if (!creative) return res.status(404).json({ message: 'Creative not found' });

    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) return res.status(400).json({ message: 'name cannot be empty' });
      creative.name = req.body.name.trim();
    }
    if (req.body.altText !== undefined) creative.altText = String(req.body.altText).trim();
    if (req.body.status !== undefined) {
      if (!['active', 'inactive', 'archived'].includes(req.body.status)) {
        return res.status(400).json({ message: 'Invalid status value' });
      }
      creative.status = req.body.status;
    }

    await creative.save();
    res.json(creative);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/creatives/:id/replace  (multipart: desktopImage?, mobileImage?)
// Swaps the underlying asset(s) in place — same creative _id, so every
// Advertisement/Campaign it's already assigned to picks up the new file
// automatically without needing to re-assign anything.
exports.replace = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid creative id' });
    const creative = await AdCreative.findById(req.params.id).populate('placement');
    if (!creative) return res.status(404).json({ message: 'Creative not found' });

    const hasDesktop = req.files && req.files.desktopImage && req.files.desktopImage[0];
    const hasMobile = req.files && req.files.mobileImage && req.files.mobileImage[0];
    if (!hasDesktop && !hasMobile) {
      return res.status(400).json({ message: 'Provide a replacement desktop and/or mobile file' });
    }

    const assets = await processIncomingAssets(req.files, creative.placement);

    if (assets.desktop) creative.desktop = assets.desktop;
    if (assets.mobile) creative.mobile = assets.mobile;

    await creative.save();

    await writeAudit({
      entityId: creative._id,
      action: 'creative_replace',
      performedBy: req.user._id,
      changes: {
        desktopReplaced: !!assets.desktop,
        mobileReplaced: !!assets.mobile,
        desktop: assets.desktop ? { width: assets.desktop.width, height: assets.desktop.height, mimeType: assets.desktop.mimeType, fileSizeBytes: assets.desktop.fileSizeBytes } : null,
        mobile: assets.mobile ? { width: assets.mobile.width, height: assets.mobile.height, mimeType: assets.mobile.mimeType, fileSizeBytes: assets.mobile.fileSizeBytes } : null
      },
      notes: 'Creative asset replaced'
    });

    res.json(creative);
  } catch (err) {
    const status = /unsupported|too large|dimensions|empty file|SVG rejected|requires exactly/i.test(err.message) ? 400 : 500;
    res.status(status).json({ message: err.message });
  }
};

// PATCH /api/creatives/:id/assign  { advertisementId?, campaignId? }
// Handles both "Assign to advertisement" and "Assign to campaign". This is
// also how "Reuse" works: calling this again with a different
// advertisementId attaches the same creative to another ad without
// touching its existing assignments.
exports.assign = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid creative id' });
    const creative = await AdCreative.findById(req.params.id);
    if (!creative) return res.status(404).json({ message: 'Creative not found' });

    const { advertisementId, campaignId } = req.body;

    if (advertisementId !== undefined) {
      if (advertisementId === null || advertisementId === '') {
        creative.advertisements = [];
      } else {
        if (!isValidId(advertisementId)) return res.status(400).json({ message: 'Invalid advertisement id' });
        const ad = await Advertisement.findById(advertisementId);
        if (!ad) return res.status(404).json({ message: 'Advertisement not found' });

        if (!creative.advertisements.some((id) => String(id) === String(ad._id))) {
          creative.advertisements.push(ad._id);
        }
        // Keep the inverse side (Advertisement.creatives) in sync so
        // whichever side a future screen reads from stays consistent.
        if (!ad.creatives.some((id) => String(id) === String(creative._id))) {
          ad.creatives.push(creative._id);
          await ad.save();
        }
      }
    }

    if (campaignId !== undefined) {
      if (campaignId === null || campaignId === '') {
        creative.campaign = null;
      } else {
        if (!isValidId(campaignId)) return res.status(400).json({ message: 'Invalid campaign id' });
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
        creative.campaign = campaign._id;
      }
    }

    await creative.save();
    const populated = await AdCreative.findById(creative._id)
      .populate('campaign', 'name campaignCode')
      .populate('advertisements', 'name status');
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/creatives/:id/unassign  { advertisementId }
// Removes a single advertisement assignment (keeps everything else the
// creative is attached to untouched) — the counterpart to reuse-by-assign.
exports.unassign = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid creative id' });
    const { advertisementId } = req.body;
    if (!advertisementId || !isValidId(advertisementId)) {
      return res.status(400).json({ message: 'A valid advertisementId is required' });
    }

    const creative = await AdCreative.findById(req.params.id);
    if (!creative) return res.status(404).json({ message: 'Creative not found' });

    creative.advertisements = creative.advertisements.filter((id) => String(id) !== String(advertisementId));
    await creative.save();

    await Advertisement.findByIdAndUpdate(advertisementId, { $pull: { creatives: creative._id } });

    res.json(creative);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/creatives/:id
// Blocked while the creative is still attached to any Advertisement —
// same "archive/unassign first" safety pattern used for Placements and
// Advertisers elsewhere in the console, so a live ad slot never loses its
// image out from under it.
exports.remove = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid creative id' });
    const creative = await AdCreative.findById(req.params.id);
    if (!creative) return res.status(404).json({ message: 'Creative not found' });

    if (creative.advertisements && creative.advertisements.length) {
      return res.status(409).json({
        message: `Cannot delete: still assigned to ${creative.advertisements.length} advertisement(s). Unassign first.`
      });
    }

    await AdCreative.findByIdAndDelete(req.params.id);
    res.json({ message: 'Creative deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
