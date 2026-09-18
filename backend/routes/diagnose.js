// backend/routes/diagnose.js
//
// TEMPORARY browser-accessible version of scripts/diagnoseAdDelivery.js
// Admin/editor login required (uses same cookie session as admin panel).
// DELETE THIS FILE once debugging is done — do not leave a diagnostic
// endpoint live in production.
//
// USAGE (open in browser after logging into /admin):
//   /api/diagnose/ad-delivery?term=CoinOsprey&device=mobile
//
// Query params (all optional except term):
//   term        - search text (matches Ad name / Campaign name / Advertiser companyName)
//   device      - mobile | desktop | tablet   (default: mobile)
//   language    - en | hi                     (default: any)
//   page        - page targeting key          (default: any)
//   placement   - placement key                (default: all assigned)
//   date        - ISO date                     (default: now)

const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');

const Advertisement = require('../models/Advertisement');
const Advertiser = require('../models/Advertiser');
const Campaign = require('../models/Campaign');
const AdSetting = require('../models/AdSetting');

const {
  isWithinSchedule,
  isCampaignLiveForDelivery,
  isAdvertiserLiveForDelivery,
  matchesLanguageTargeting,
  matchesDeviceTargeting,
  placementSupportsDevice,
  resolvePageTargetingMatch,
  checkCreativePlacementCompatibility,
  selectDeliveryCreative
} = require('../utils/advertisementLogic');

router.get('/ad-delivery', protect, adminOnly, async (req, res) => {
  const out = [];
  const line = () => out.push('─'.repeat(72));
  const pass = (label) => out.push(`  PASS - ${label}`);
  const fail = (label, reason) => out.push(`  FAIL - ${label}\n       reason: ${reason}`);

  try {
    const searchTerm = req.query.term;
    if (!searchTerm) {
      return res.status(400).type('text').send('Missing ?term= query param');
    }

    const device = req.query.device ? String(req.query.device).trim().toLowerCase() : 'mobile';
    const language = req.query.language ? String(req.query.language).trim().toLowerCase() : undefined;
    const page = req.query.page ? String(req.query.page).trim() : undefined;
    const placementKeyFilter = req.query.placement ? String(req.query.placement).trim().toLowerCase() : undefined;
    const now = req.query.date ? new Date(req.query.date) : new Date();

    out.push(`Running diagnostic for: "${searchTerm}"`);
    out.push(`Context => device: ${device} | language: ${language || '(any)'} | page: ${page || '(any)'} | placement: ${placementKeyFilter || '(all assigned)'} | date: ${now.toISOString()}`);
    line();

    // ---- 0. Global kill switch ----
    const settings = await AdSetting.findOne({ key: 'global' }).select('adsEnabled');
    const adsEnabledGlobally = !settings || settings.adsEnabled !== false;
    out.push('GLOBAL KILL SWITCH (AdSetting.adsEnabled)');
    if (adsEnabledGlobally) {
      pass('Advertising is enabled site-wide');
    } else {
      fail('Advertising is enabled site-wide', 'AdSetting.adsEnabled is false - ALL ads are blocked regardless of anything else');
    }
    line();

    // ---- find matching advertisers / campaigns / advertisements ----
    const rx = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const matchingAdvertisers = await Advertiser.find({ companyName: rx }).select('_id');
    const matchingCampaigns = await Campaign.find({ name: rx }).select('_id');

    const orClauses = [
      { name: rx },
      { advertiser: { $in: matchingAdvertisers.map(a => a._id) } },
      { campaign: { $in: matchingCampaigns.map(c => c._id) } }
    ];

    const ads = await Advertisement.find({ $or: orClauses })
      .populate('advertiser')
      .populate('campaign')
      .populate('creatives')
      .populate('placements');

    if (!ads.length) {
      out.push(`No Advertisement found matching "${searchTerm}" (checked Advertisement.name, Campaign.name, Advertiser.companyName).`);
      out.push('Nothing further to check - no matching ad exists in this DB, not a targeting/schedule issue.');
      return res.type('text').send(out.join('\n'));
    }

    out.push(`Found ${ads.length} matching Advertisement(s).`);
    line();

    for (const ad of ads) {
      out.push(`AD: "${ad.name}"  (id: ${ad._id})`);
      out.push(`  advertiser: ${ad.advertiser ? ad.advertiser.companyName : '(none)'}   campaign: ${ad.campaign ? ad.campaign.name : '(none)'}`);
      line();

      let adOk = true;
      const failReasons = [];

      function record(ok, label, reason) {
        if (ok) { pass(label); }
        else { fail(label, reason); adOk = false; failReasons.push(`${label} - ${reason}`); }
      }

      record(ad.status === 'active', 'Advertisement.status must be "active"', `current status is "${ad.status}"`);
      record(
        !!ad.approval && ad.approval.status === 'approved',
        'Advertisement.approval.status must be "approved"',
        `current approval.status is "${ad.approval ? ad.approval.status : '(missing)'}"` + (ad.approval && ad.approval.rejectionReason ? ` | rejectionReason: "${ad.approval.rejectionReason}"` : '')
      );

      {
        const s = ad.schedule || {};
        record(
          isWithinSchedule(ad.schedule, now),
          `Schedule window covers now (${now.toISOString()})`,
          `startDate=${s.startDate ? new Date(s.startDate).toISOString() : '?'} .. endDate=${s.endDate ? new Date(s.endDate).toISOString() : '?'}`
        );
      }

      record(
        isCampaignLiveForDelivery(ad.campaign),
        'Campaign status is "active"',
        ad.campaign ? `campaign status is "${ad.campaign.status}" - delivery requires exactly "active"` : 'advertisement has no campaign attached'
      );

      record(
        isAdvertiserLiveForDelivery(ad.advertiser),
        'Advertiser status is allowed',
        ad.advertiser ? `advertiser status is "${ad.advertiser.status}" - blocked/archived/pending advertisers cannot serve` : 'advertisement has no advertiser attached'
      );

      {
        const langs = ad.targeting && ad.targeting.languages;
        record(
          !language || matchesLanguageTargeting(langs, language),
          `Language targeting ok for "${language || '(any)'}"`,
          `ad restricts to [${(langs || []).join(', ')}]`
        );
      }

      {
        const devices = ad.targeting && ad.targeting.devices;
        record(
          matchesDeviceTargeting(devices, device),
          `Device targeting ok for "${device}"`,
          `ad restricts to [${(devices || []).join(', ')}]`
        );
      }

      {
        const pageMatch = resolvePageTargetingMatch(ad.targeting, { page, url: req.query.url, categoryId: req.query.categoryId, articleId: req.query.articleId });
        record(
          pageMatch.matched,
          'Page/URL targeting matched',
          `ad's targeting.pages=[${(ad.targeting && ad.targeting.pages || []).join(', ')}] did not match requested page "${page || '(none)'}"`
        );
      }

      const placements = Array.isArray(ad.placements) ? ad.placements : [];
      if (!placements.length) {
        record(false, 'Placement assignment', 'this advertisement has no placements assigned at all');
      } else {
        const relevantPlacements = placementKeyFilter
          ? placements.filter(p => p.key === placementKeyFilter)
          : placements;

        if (placementKeyFilter && !relevantPlacements.length) {
          record(false, 'Placement assignment', `ad is not assigned to placement "${placementKeyFilter}" (assigned to: [${placements.map(p => p.key).join(', ')}])`);
        }

        for (const placement of relevantPlacements) {
          out.push(`  -- placement "${placement.key}" --`);

          record(!!placement.active, `  Placement "${placement.key}" is active`, 'this placement is disabled - nothing can serve here regardless of the ad');
          if (!placement.active) continue;

          record(
            placementSupportsDevice(placement.device, device),
            `  Placement "${placement.key}" supports device "${device}"`,
            `placement.device is "${placement.device}", requested device is "${device}"`
          );

          const creative = selectDeliveryCreative(ad.creatives, placement);
          record(
            !!creative,
            `  Creative compatibility for "${placement.key}"`,
            creative ? '' : 'no creative attached to this ad is compatible with this placement'
          );
          if (creative) {
            out.push(`       -> using creative "${creative.name}"`);
          } else {
            (ad.creatives || []).forEach((c) => {
              const errors = checkCreativePlacementCompatibility(c, placement);
              if (errors.length) out.push(`       creative "${c.name}": ${errors.join('; ')}`);
            });
          }
        }
      }

      line();
      if (adOk) {
        out.push(`  OVERALL: "${ad.name}" WOULD BE SERVED (subject to rotation against other eligible ads in the same placement).`);
      } else {
        out.push(`  FAILS delivery because:`);
        failReasons.forEach(r => out.push(`     - ${r}`));
      }
      line();
      out.push('');
    }

    return res.type('text').send(out.join('\n'));
  } catch (err) {
    out.push('Diagnostic route crashed:');
    out.push(String(err && err.stack ? err.stack : err));
    return res.status(500).type('text').send(out.join('\n'));
  }
});

module.exports = router;
