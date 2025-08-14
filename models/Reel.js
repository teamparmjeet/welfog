const mongoose = require("mongoose");

const reelSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User4', required: true },
        userid: {type: String, required: true},
        username: {type: String, required: true },
        videoUrl: { type: String, required: true },
        thumbnailUrl: { type: String },
        title: { type: String },
        status: {
            type: String,
            enum: ['Published', 'Processing', 'Blocked','Reported']
        },
        caption: { type: String },
        category: { type: String },
        description: { type: String },  
        duration: { type: Number }, // in seconds
        likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User4' }],
        views: { type: Number, default: 0 },
        comments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
        music: { type: mongoose.Schema.Types.ObjectId, ref: 'Music' },
        shares: [
            {
                sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User4', required: true },
                sharedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User4', required: true },
                sharedAt: { type: Date, default: Date.now }
            }
        ]
    }, { timestamps: true }
);

module.exports = mongoose.model('Reel4', reelSchema);