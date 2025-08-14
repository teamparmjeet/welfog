const mongoose = require("mongoose");

const userLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    action: {
        type: String,
        enum: [
            "view_reel",
            "like_reel",
            "unlike_reel",
            "comment",
            "share_reel",
            "update_reel",
            "login",
            "logout",
            "follow_user",
            "unfollow_user",
            "report_reel",
            "upload_reel",
            "delete_reel"
        ],
        required: true,
    },
    targetType: {
        type: String, // e.g., 'Reel', 'Comment', 'User'
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId, // reel id, comment id, user id
    },
    device: {
        type: String, // optional: mobile, desktop, etc.
    },
    location: {
        ip: String,
        country: String,
        city: String,
        pincode: String,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model("UserLog", userLogSchema);