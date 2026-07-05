const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    article: { type: mongoose.Schema.Types.ObjectId, ref: "Article", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // null for guest comments
    name: { type: String, required: true, trim: true }, // display name (guest or user snapshot)
    email: { type: String, required: true, trim: true, lowercase: true },
    body: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ["pending", "approved", "spam", "rejected"], default: "pending" },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null },
    ip: { type: String, select: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Comment", commentSchema);
