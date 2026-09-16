// One-time data migration for PART 8B's Advertisement schema addition:
//   - `lastServedAt` (Date, default null)
//   - `deliveryCount` (Number, default 0)
//
// Both fields already have schema defaults, so any *new* Advertisement
// document gets them automatically — this migration only exists to
// backfill `deliveryCount` on documents created before this part shipped,
// so EVEN rotation's "$inc: { deliveryCount: 1 }" always increments a
// real number rather than starting from `undefined`.
//
// Safe to run multiple times — only touches documents missing the field.
//
// Usage:
//   node backend/migrations/2026-advertisement-delivery-tracking.js
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

  const result = await col.updateMany(
    { deliveryCount: { $exists: false } },
    { $set: { deliveryCount: 0, lastServedAt: null } }
  );

  console.log(`Backfilled deliveryCount/lastServedAt on ${result.modifiedCount} document(s).`);

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
