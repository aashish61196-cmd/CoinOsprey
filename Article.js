const mongoose = require("mongoose");
const slugify = require("slugify");

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, index: true },
    excerpt: { type: String, maxlength: 300, default: "" },
    content: { type: String, required: true }, // sanitized HTML/markdown
    coverImage: { type: String, default: "" }, // /uploads/xyz.jpg
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    tags: [{ type: String, trim: true, lowercase: true }],
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    publishedAt: { type: Date },
    views: { type: Number, default: 0 },

    // SEO
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    canonicalUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

articleSchema.index({ title: "text", excerpt: "text", content: "text", tags: "text" });

articleSchema.pre("validate", function setSlugAndMeta(next) {
  if (this.title && (!this.slug || this.isModified("title"))) {
    this.slug = `${slugify(this.title, { lower: true, strict: true })}-${Date.now().toString(36)}`;
  }
  if (!this.metaTitle) this.metaTitle = this.title;
  if (!this.metaDescription && this.excerpt) this.metaDescription = this.excerpt.slice(0, 160);
  next();
});

articleSchema.pre("save", function setPublishedAt(next) {
  if (this.isModified("status") && this.status === "published" && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

module.exports = mongoose.model("Article", articleSchema);
