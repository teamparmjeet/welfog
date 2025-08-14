  const mongoose = require('mongoose');

  const commentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User4', required: true },
    reel: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel4', required: true },
    text: { type: String, required: true },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User4' }],
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  }, { timestamps: true });

  module.exports = mongoose.model('Comment', commentSchema);