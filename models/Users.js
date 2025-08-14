const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  userid: { type: String, required: true, unique: true },
  username: { type: String, unique: true },
  mobile: { type: String, required: true, unique: true },
  email: { type: String },
  profilePicture: { type: String, default: "" },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User4' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User4' }],
  bio: { type: String, default: "" },
  isSuspended: { type: Boolean, required: true, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User4", userSchema);
