const mongoose = require("mongoose");
const crypto = require("crypto");

const newsletterSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ["subscribed", "unsubscribed"], default: "subscribed" },
    unsubscribeToken: { type: String, unique: true },
    subscribedAt: { type: Date, default: Date.now },
    unsubscribedAt: { type: Date },
  },
  { timestamps: true }
);

newsletterSchema.pre("validate", function setToken(next) {
  if (!this.unsubscribeToken) {
    this.unsubscribeToken = crypto.randomBytes(20).toString("hex");
  }
  next();
});

module.exports = mongoose.model("Newsletter", newsletterSchema);
