const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: String,
  url: { type: String, required: true }, // audio file URL
  thumbnail: String,
  duration: Number, // optional: length in seconds
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User4' }, // admin/user
}, { timestamps: true });

module.exports = mongoose.model('Music', musicSchema);
