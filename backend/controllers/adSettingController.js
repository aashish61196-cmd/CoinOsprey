const mongoose = require('mongoose');
const AdSetting = require('../models/AdSetting');
const AdAuditLog = require('../models/AdAuditLog');
const { isValidTimezone } = require('../utils/timezone');
const { validateDestinationUrl } = require('../utils/urlValidation');
const AdCreative = require('../models/AdCreative');

async function writeAudit({ entityId, action, performedBy, changes = {}, notes = '' }) {
  try {
    await AdAuditLog.create({ entityType: 'AdSetting', entityId, action, performedBy, changes, notes });
  } catch (err) {
    console.error('AdAuditLog write failed:', err.message);
  }
}

function validate(body) {
  const errors = [];
  const bool = (v, label) => { if (v !== undefined && typeof v !== 'boolean') errors.push(`${label} must be boolean`); };
  if (body.adsEnabled !== undefined && typeof body.adsEnabled !== 'boolean') errors.push('adsEnabled must be boolean');
  if (body.defaultCurrency !== undefined && !/^[A-Z]{3}$/.test(String(body.defaultCurrency))) errors.push('defaultCurrency must be a 3-letter currency code');
  if (body.defaultTimezone !== undefined && !isValidTimezone(String(body.defaultTimezone))) errors.push('defaultTimezone is invalid');
  if (body.maxAdsPerPage !== undefined && (!Number.isInteger(Number(body.maxAdsPerPage)) || Number(body.maxAdsPerPage) < 0 || Number(body.maxAdsPerPage) > 100)) errors.push('maxAdsPerPage must be an integer from 0 to 100');
  if (body.defaultAdvertisementStatus !== undefined && !AdSetting.DEFAULT_AD_STATUS_VALUES.includes(body.defaultAdvertisementStatus)) errors.push('defaultAdvertisementStatus is not allowed');
  if (body.defaultRotationMode !== undefined && !AdSetting.ROTATION_MODE_VALUES.includes(body.defaultRotationMode)) errors.push('defaultRotationMode is not allowed');
  if (body.display !== undefined) {
    bool(body.display.showAdvertisementLabel, 'display.showAdvertisementLabel');
    bool(body.display.lazyLoading, 'display.lazyLoading');
    if (body.display.responsiveBehavior !== undefined && !['responsive','fixed'].includes(body.display.responsiveBehavior)) errors.push('display.responsiveBehavior is invalid');
  }
  if (body.tracking !== undefined) {
    bool(body.tracking.impressionTracking, 'tracking.impressionTracking');
    bool(body.tracking.clickTracking, 'tracking.clickTracking');
    bool(body.tracking.utmGeneration, 'tracking.utmGeneration');
  }
  if (body.safety !== undefined) {
    const n = Number(body.safety.maxCreativeSizeBytes);
    if (body.safety.maxCreativeSizeBytes !== undefined && (!Number.isInteger(n) || n < 1024 || n > 10485760)) errors.push('safety.maxCreativeSizeBytes must be an integer from 1KB to 10MB');
    if (body.safety.allowedFileTypes !== undefined) {
      if (!Array.isArray(body.safety.allowedFileTypes) || !body.safety.allowedFileTypes.length) errors.push('safety.allowedFileTypes must contain at least one file type');
      else if (body.safety.allowedFileTypes.some(v => !['image/jpeg','image/png','image/webp','image/svg+xml'].includes(v))) errors.push('safety.allowedFileTypes contains an unsupported type');
    }
    bool(body.safety.externalUrlValidation, 'safety.externalUrlValidation');
  }
  bool(body.houseAdsEnabled, 'houseAdsEnabled');
  if (body.houseAdCreative !== undefined && body.houseAdCreative !== null && body.houseAdCreative !== '' && !mongoose.Types.ObjectId.isValid(body.houseAdCreative)) errors.push('houseAdCreative is invalid');
  if (body.houseAdDestinationUrl !== undefined && body.houseAdDestinationUrl !== '') {
    const result = validateDestinationUrl(String(body.houseAdDestinationUrl));
    if (!result.ok) errors.push(result.error);
  }
  bool(body.houseAdOpenInNewTab, 'houseAdOpenInNewTab');
  bool(body.requireApprovalBeforeLive, 'requireApprovalBeforeLive');

  if (body.houseAds !== undefined) {
    if (!Array.isArray(body.houseAds)) errors.push('houseAds must be an array');
    else if (body.houseAds.length > 50) errors.push('houseAds cannot contain more than 50 items');
    else body.houseAds.forEach((h, i) => {
      if (!h || typeof h !== 'object') return errors.push(`houseAds[${i}] is invalid`);
      if (!String(h.name || '').trim()) errors.push(`houseAds[${i}].name is required`);
      if (!mongoose.Types.ObjectId.isValid(h.creative)) errors.push(`houseAds[${i}].creative is invalid`);
      if (!h.destinationUrl) errors.push(`houseAds[${i}].destinationUrl is required`);
      else {
        const r = validateDestinationUrl(String(h.destinationUrl));
        if (!r.ok) errors.push(`houseAds[${i}]: ${r.error}`);
      }
      if (h.category && !['latest_news','price_predictions','crypto_education','rankings','custom'].includes(h.category)) errors.push(`houseAds[${i}].category is invalid`);
      if (h.priority !== undefined && (!Number.isInteger(Number(h.priority)) || Number(h.priority) < 1 || Number(h.priority) > 100)) errors.push(`houseAds[${i}].priority must be 1-100`);
      bool(h.active, `houseAds[${i}].active`);
      bool(h.openInNewTab, `houseAds[${i}].openInNewTab`);
    });
  }
  return errors;
}

exports.get = async (req, res) => {
  try {
    const settings = await AdSetting.findOne({ key: 'global' }).populate('houseAdCreative', 'name status desktop mobile').populate('houseAds.creative', 'name status desktop mobile');
    res.json(settings || new AdSetting({ key: 'global' }));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.update = async (req, res) => {
  try {
    const errors = validate(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors.join('; ') });

    const beforeDoc = await AdSetting.findOne({ key: 'global' }).lean();
    const creativeIds = [];
    if (req.body.houseAdCreative) creativeIds.push(req.body.houseAdCreative);
    (req.body.houseAds || []).forEach(h => { if (h && h.creative) creativeIds.push(h.creative); });
    if (creativeIds.length) {
      const creatives = await AdCreative.find({ _id: { $in: creativeIds } }).select('_id status');
      const map = new Map(creatives.map(c => [String(c._id), c]));
      for (const id of creativeIds) {
        const creative = map.get(String(id));
        if (!creative) return res.status(400).json({ message: `House advertisement creative ${id} not found` });
        if (creative.status !== 'active') return res.status(400).json({ message: `House advertisement creative ${id} must be active` });
      }
    }

    const allowed = ['adsEnabled','defaultCurrency','defaultTimezone','maxAdsPerPage','defaultAdvertisementStatus','defaultRotationMode','display','tracking','safety','houseAdsEnabled','houseAds','houseAdCreative','houseAdDestinationUrl','houseAdOpenInNewTab','requireApprovalBeforeLive'];
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (patch.defaultAdvertisementStatus === 'approved' && patch.requireApprovalBeforeLive === true) {
      // Approval remains mandatory: the new ad may start in an approved workflow state,
      // but cannot become live until the dedicated approval/publish action completes.
    }

    const settings = await AdSetting.findOneAndUpdate(
      { key: 'global' },
      { $setOnInsert: { key: 'global' }, $set: patch },
      { new: true, upsert: true, runValidators: true }
    ).populate('houseAdCreative', 'name status desktop mobile').populate('houseAds.creative', 'name status desktop mobile');

    const after = settings.toObject();
    const before = beforeDoc || null;
    await writeAudit({ entityId: settings._id, action: 'settings_changed', performedBy: req.user._id, changes: { before, after }, notes: 'Advertising settings changed' });
    res.json(settings);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = exports;
