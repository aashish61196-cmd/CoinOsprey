const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema(
  {
    article: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: {
      type: String,
      required: [true, 'Comment content is required'],
      trim: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters'],
    },

    // ---- Threaded replies ----
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
    },

    // ---- Moderation ----
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'spam'],
      default: 'pending',
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    moderatedAt: {
      type: Date,
    },

    // ---- Engagement ----
    likes: {
      type: Number,
      default: 0,
    },
    likedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],

    // ---- Metadata ----
    ipAddress: {
      type: String,
      select: false,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// ---- Indexes for common query patterns ----
CommentSchema.index({ article: 1, status: 1, createdAt: -1 });
CommentSchema.index({ parentComment: 1 });
CommentSchema.index({ author: 1 });

// ---- Track edits ----
CommentSchema.pre('save', function (next) {
  if (this.isModified('content') && !this.isNew) {
    this.isEdited = true;
    this.editedAt = new Date();
  }
  next();
});

// ---- Instance method: toggle like from a user ----
CommentSchema.methods.toggleLike = async function (userId) {
  const index = this.likedBy.findIndex((id) => id.toString() === userId.toString());

  if (index === -1) {
    this.likedBy.push(userId);
    this.likes += 1;
  } else {
    this.likedBy.splice(index, 1);
    this.likes = Math.max(0, this.likes - 1);
  }

  return this.save();
};

// ---- Static method: get approved comments for an article (threaded) ----
CommentSchema.statics.getThreadedComments = async function (articleId) {
  const comments = await this.find({ article: articleId, status: 'approved' })
    .sort({ createdAt: 1 })
    .populate('author', 'name avatar')
    .lean();

  const commentMap = {};
  const rootComments = [];

  comments.forEach((comment) => {
    comment.replies = [];
    commentMap[comment._id] = comment;
  });

  comments.forEach((comment) => {
    if (comment.parentComment) {
      const parent = commentMap[comment.parentComment];
      if (parent) {
        parent.replies.push(comment);
      }
    } else {
      rootComments.push(comment);
    }
  });

  return rootComments;
};

// ---- Post-save hook: keep Article.commentsCount in sync ----
CommentSchema.post('save', async function (doc) {
  if (doc.status === 'approved') {
    const Article = mongoose.model('Article');
    const count = await mongoose.model('Comment').countDocuments({
      article: doc.article,
      status: 'approved',
    });
    await Article.findByIdAndUpdate(doc.article, { commentsCount: count });
  }
});

module.exports = mongoose.model('Comment', CommentSchema);
