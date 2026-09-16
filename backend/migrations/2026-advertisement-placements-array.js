// One-time data migration for Part 7A-1's Advertisement schema changes:
//   1. `placement` (single ObjectId)      -> `placements` (array of ObjectId)
//   2. status "pending_approval"          -> "pending_review"
//      (aligning Advertisement with Campaign's already-established
//      status vocabulary; every other status value is unchanged)
//
// Safe to run multiple times — every step only touches documents still in
// the old shape, so re-running after a successful migration is a no-op.
// Does NOT touch AdImpression/AdClick (those keep a single `placement`
// per event on purpose — an impression happens in exactly one slot even
// if the ad is eligible for several) or any other collection.
//
// Usage:
//   node backend/migrations/2026-advertisement-placements-array.js
//
// Requires the same MONGO_URI env var the app itself uses.

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const col = db.collection('advertisements');

  // 1) placement -> placements
  const legacyPlacementCursor = col.find({ placement: { $exists: true }, placements: { $exists: false } });
  let migratedPlacements = 0;
  // eslint-disable-next-line no-await-in-loop
  for await (const doc of legacyPlacementCursor) {
    // eslint-disable-next-line no-await-in-loop
    await col.updateOne(
      { _id: doc._id },
      { $set: { placements: doc.placement ? [doc.placement] : [] }, $unset: { placement: '' } }
    );
    migratedPlacements += 1;
  }

  // 2) pending_approval -> pending_review
  const statusResult = await col.updateMany(
    { status: 'pending_approval' },
    { $set: { status: 'pending_review' } }
  );

  console.log(`Migrated ${migratedPlacements} document(s) from placement -> placements.`);
  console.log(`Migrated ${statusResult.modifiedCount} document(s) from pending_approval -> pending_review.`);

  await mongoose.disconnect();
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { run };
