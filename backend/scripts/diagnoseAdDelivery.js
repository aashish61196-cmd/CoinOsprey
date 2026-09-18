
// backend/scripts/diagnoseAdDelivery.js
//
// Standalone diagnostic script. Connects to the SAME MongoDB the app uses
// (via MONGO_URI in .env) and replicates the exact checks that
// services/advertisementDeliveryService.js + utils/advertisementLogic.js
// run on the live delivery path — then prints PASS/FAIL with a reason for
// every single check, per matching Advertisement.
//
// This does not call the app's HTTP server. It talks to the DB directly
// with the same Mongoose models, so results reflect exactly what the
// delivery engine would decide right now.
//
// USAGE:
//   cd backend
//   node scripts/diagnoseAdDelivery.js "<search term>" [options]
//
// <search term> matches (case-insensitive, partial) against:
//   - Advertisement.name
//   - Campaign.name
//   - Advertiser.companyName
//
// OPTIONS:
//   --device=mobile|desktop|tablet   (default: mobile)
//   --language=en|hi                 (default: none, i.e. not checked)
//   --page=<page targeting key>      (default: none)
//   --placement=<placement key>      (default: none — checks all placements the ad is assigned to)
//   --date=<ISO date>                (default: now)
//
// EXAMPLE:
//   node scripts/diagnoseAdDelivery.js "CoinOsprey" --device=mobile

require('dotenv').config();
const mongoose = require('mongoose');

const Advertisement = require('../models/Advertisement');
const Advertiser = require('../models/Advertiser');
const Campaign = require('../models/Campaign');
const AdPlacement = require('../models/AdPlacement');
const AdSetting = require('../models/AdSetting');

const {
  isAdvertisementLiveForDelivery,
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

// ---------------------------------------------------------------
// arg parsing
// ---------------------------------------------------------------
function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const opts = {};
  for (const a of args) {
    if (a.startsWith('--')) {
      const [key, ...rest] = a.slice(2).split('=');
      opts[key] = rest.length ? rest.join('=') : true;
    } else {
      positional.push(a);
    }
  }
  return { searchTerm: positional[0], opts };
}

const { searchTerm, opts } = parseArgs(process.argv);

if (!searchTerm) {
  console.error('Usage: node scripts/diagnoseAdDelivery.js "<search term>" [--device=mobile] [--language=en] [--page=homepage] [--placement=sidebar] [--date=ISO]');
  process.exit(1);
}

const device = opts.device ? String(opts.device).trim().toLowerCase() : 'mobile';
const language = opts.language ? String(opts.language).trim().toLowerCase() : undefined;
const page = opts.page ? String(opts.page).trim() : undefined;
const placementKeyFilter = opts.placement ? String(opts.placement).trim().toLowerCase() : undefined;
const now = opts.date ? new Date(opts.date) : new Date();

function line() { console.log('─'.repeat(72)); }
function pass(label) { console.log(`  ✅ PASS — ${label}`); }
function fail(label, reason) { console.log(`  ❌ FAIL — ${label}\n       reason: ${reason}`); }

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Run this from backend/ with your .env present.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to DB. Running diagnostic for: "${searchTerm}"`);
  console.log(`Context => device: ${device} | language: ${language || '(any)'} | page: ${page || '(any)'} | placement: ${placementKeyFilter || '(all assigned)'} | date: ${now.toISOString()}`);
  line();

  // ---- 0. Global kill switch ----
  const settings = await AdSetting.findOne({ key: 'global' }).select('adsEnabled');
  const adsEnabledGlobally = !settings || settings.adsEnabled !== false;
  console.log('GLOBAL KILL SWITCH (AdSetting.adsEnabled)');
  if (adsEnabledGlobally) {
    pass('Advertising is enabled site-wide');
  } else {
    fail('Advertising is enabled site-wide', 'AdSetting.adsEnabled is false — ALL ads are blocked regardless of anything else');
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
    console.log(`No Advertisement found matching "${searchTerm}" (checked Advertisement.name, Campaign.name, Advertiser.companyName).`);
    console.log('Nothing further to check — the reason nothing shows is that no matching ad exists in this DB, not a targeting/schedule issue.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${ads.length} matching Advertisement(s).`);
  line();

  for (const ad of ads) {
    console.log(`AD: "${ad.name}"  (id: ${ad._id})`);
    console.log(`  advertiser: ${ad.advertiser ? ad.advertiser.companyName : '(none)'}   campaign: ${ad.campaign ? ad.campaign.name : '(none)'}`);
    line();

    let adOk = true;
    const failReasons = [];

    function record(ok, label, reason) {
      if (ok) { pass(label); }
      else { fail(label, reason); adOk = false; failReasons.push(`${label} — ${reason}`); }
    }

    // 1. status + approval
    record(ad.status === 'active', 'Advertisement.status must be "active"', `current status is "${ad.status}"`);
    record(
      !!ad.approval && ad.approval.status === 'approved',
      'Advertisement.approval.status must be "approved"',
      `current approval.status is "${ad.approval ? ad.approval.status : '(missing)'}"` + (ad.approval && ad.approval.rejectionReason ? ` | rejectionReason: "${ad.approval.rejectionReason}"` : '')
    );

    // 2. schedule window
    {
      const s = ad.schedule || {};
      record(
        isWithinSchedule(ad.schedule, now),
        `Schedule window covers now (${now.toISOString()})`,
        `startDate=${s.startDate ? new Date(s.startDate).toISOString() : '?'} .. endDate=${s.endDate ? new Date(s.endDate).toISOString() : '?'}`
      );
    }

    // 3. campaign live status (must be exactly 'active')
    record(
      isCampaignLiveForDelivery(ad.campaign),
      'Campaign status is "active"',
      ad.campaign ? `campaign status is "${ad.campaign.status}" — delivery requires exactly "active"` : 'advertisement has no campaign attached'
    );

    // 4. advertiser live status
    record(
      isAdvertiserLiveForDelivery(ad.advertiser),
      'Advertiser status is allowed',
      ad.advertiser ? `advertiser status is "${ad.advertiser.status}" — blocked/archived/pending advertisers cannot serve` : 'advertisement has no advertiser attached'
    );

    // 5. language targeting
    {
      const langs = ad.targeting && ad.targeting.languages;
      record(
        !language || matchesLanguageTargeting(langs, language),
        `Language targeting ok for "${language || '(any)'}"`,
        `ad restricts to [${(langs || []).join(', ')}]`
      );
    }

    // 6. device targeting (ad-level)
    {
      const devices = ad.targeting && ad.targeting.devices;
      record(
        matchesDeviceTargeting(devices, device),
        `Device targeting ok for "${device}"`,
        `ad restricts to [${(devices || []).join(', ')}]`
      );
    }

    // 7. page targeting
    {
      const pageMatch = resolvePageTargetingMatch(ad.targeting, { page, url: opts.url, categoryId: opts.categoryId, articleId: opts.articleId });
      record(
        pageMatch.matched,
        'Page/URL targeting matched',
        `ad's targeting.pages=[${(ad.targeting && ad.targeting.pages || []).join(', ')}] did not match requested page "${page || '(none)'}"`
      );
    }

    // 8. placement assignment + placement-level device support + creative compatibility
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
        console.log(`  -- placement "${placement.key}" --`);

        record(!!placement.active, `  Placement "${placement.key}" is active`, 'this placement is disabled — nothing can serve here regardless of the ad');
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
          console.log(`       -> using creative "${creative.name}"`);
        } else {
          (ad.creatives || []).forEach((c) => {
            const errors = checkCreativePlacementCompatibility(c, placement);
            if (errors.length) console.log(`       creative "${c.name}": ${errors.join('; ')}`);
          });
        }
      }
    }

    line();
    if (adOk) {
      console.log(`  ✅ OVERALL: "${ad.name}" WOULD BE SERVED (subject to rotation against other eligible ads in the same placement).`);
    } else {
      console.log(`  ❌ FAILS delivery because:`);
      failReasons.forEach(r => console.log(`     - ${r}`));
    }
    line();
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Diagnostic script crashed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
