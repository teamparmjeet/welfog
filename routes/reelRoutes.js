const express = require("express");
const mongoose = require('mongoose');
const router = express.Router();
const Reel = require("../models/Reel");
const User = require("../models/Users");
const Music = require("../models/Music"); // <-- import Music model
const multer = require("multer");
const logUserAction = require("../utils/logUserAction");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const tmp = require("tmp");
const https = require("https");
const { uploadToS3 } = require("../lib/s3");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);


const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 } // allow up to 200MB
});


router.post(
    "/full-upload",
    upload.fields([
        { name: "video", maxCount: 1 },
        { name: "thumbnail", maxCount: 1 },
    ]),
    async (req, res) => {
        console.log("===== [FULL UPLOAD WITH TRIM STARTED] =====");

        // Keep track of all temporary files for cleanup
        const tempFiles = [];

        try {
            // --- Step 1: Extract data from request ---
            const {
                user,
                userid,
                username,
                caption,
                musicId,
                videoStartTime,
                videoEndTime,
                musicStartTime,
                musicEndTime,

            } = req.body;

            console.log("[STEP 1] Received data:", { caption, musicId, videoStartTime, videoEndTime, musicStartTime, musicEndTime });


            if (!user || !req.files || !req.files.video) {
                return res
                    .status(400)
                    .json({ success: false, message: "User or video file missing!" });
            }

            const videoFile = req.files.video[0];
            const thumbFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

            // --- Step 2: Write original video to a temporary file ---
            const inputTmp = tmp.fileSync({ postfix: path.extname(videoFile.originalname) });
            tempFiles.push(inputTmp);
            fs.writeFileSync(inputTmp.name, videoFile.buffer);

            // --- Step 3: Trim and compress video in one go ---
            console.log("[STEP 3] Starting video processing (trim & compress)");
            const outputTmp = tmp.fileSync({ postfix: ".mp4" });
            tempFiles.push(outputTmp);

            await new Promise((resolve, reject) => {
                let command = ffmpeg(inputTmp.name);

                // Apply trimming if start and end times are provided and valid
                if (videoStartTime && videoEndTime) {
                    const startTimeSec = parseFloat(videoStartTime) / 1000;
                    const endTimeSec = parseFloat(videoEndTime) / 1000;
                    if (!isNaN(startTimeSec) && !isNaN(endTimeSec) && endTimeSec > startTimeSec) {
                        const durationSec = endTimeSec - startTimeSec;
                        console.log(`-> Trimming video from ${startTimeSec.toFixed(2)}s for ${durationSec.toFixed(2)}s`);
                        command.seekInput(startTimeSec).duration(durationSec);
                    }
                }

                command
                    .outputOptions([
                        "-c:v libx264",    // Video codec
                        "-preset veryfast",// Encoding speed
                        "-crf 28",         // Constant Rate Factor for quality/size balance
                        "-b:v 1500k",      // Max video bitrate
                        "-c:a aac",        // Audio codec
                        "-b:a 128k",       // Audio bitrate
                    ])
                    .save(outputTmp.name)
                    .on("end", () => {
                        console.log("[STEP 3] Video processing complete.");
                        resolve();
                    })
                    .on("error", (err) => {
                        console.error("[ERROR] Video processing failed:", err.message);
                        reject(err);
                    });
            });

            let finalVideoPath = outputTmp.name;
            let finalMusicId = musicId || null;

            // --- Step 4: Trim music and merge with video ---
            if (musicId && mongoose.Types.ObjectId.isValid(musicId)) {
                const musicDoc = await Music.findById(musicId);
                if (musicDoc?.url) {
                    console.log("[STEP 4] Starting audio processing for:", musicDoc.url);

                    // Download audio
                    const musicTmp = tmp.fileSync({ postfix: path.extname(musicDoc.url) });
                    tempFiles.push(musicTmp);
                    await new Promise((resolve, reject) => {
                        const file = fs.createWriteStream(musicTmp.name);
                        https.get(musicDoc.url, (response) => {
                            response.pipe(file);
                            file.on("finish", () => file.close(resolve));
                        }).on("error", reject);
                    });

                    let musicInputPath = musicTmp.name;

                    // Trim audio if times are provided
                    if (musicStartTime && musicEndTime) {
                        const startTimeSec = parseFloat(musicStartTime) / 1000;
                        const endTimeSec = parseFloat(musicEndTime) / 1000;
                        if (!isNaN(startTimeSec) && !isNaN(endTimeSec) && endTimeSec > startTimeSec) {
                            const durationSec = endTimeSec - startTimeSec;
                            console.log(`-> Trimming audio from ${startTimeSec.toFixed(2)}s for ${durationSec.toFixed(2)}s`);
                            const trimmedMusicTmp = tmp.fileSync({ postfix: ".mp3" });
                            tempFiles.push(trimmedMusicTmp);

                            await new Promise((resolve, reject) => {
                                ffmpeg(musicTmp.name)
                                    .seekInput(startTimeSec)
                                    .duration(durationSec)
                                    .audioCodec('libmp3lame') // Re-encode to ensure compatibility
                                    .save(trimmedMusicTmp.name)
                                    .on('end', resolve)
                                    .on('error', reject);
                            });
                            musicInputPath = trimmedMusicTmp.name;
                        }
                    }

                    // Merge trimmed video + (possibly) trimmed audio
                    console.log("-> Merging video with final audio track.");
                    const mergedTmp = tmp.fileSync({ postfix: ".mp4" });
                    tempFiles.push(mergedTmp);
                    await new Promise((resolve, reject) => {
                        ffmpeg(outputTmp.name)
                            .input(musicInputPath)
                            .outputOptions([
                                "-c:v copy",    // Copy video stream without re-encoding
                                "-c:a aac",     // Re-encode merged audio
                                "-map 0:v:0",   // Map video from the first input
                                "-map 1:a:0",   // Map audio from the second input
                                "-shortest",    // Finish encoding when the shortest input stream ends
                            ])
                            .save(mergedTmp.name)
                            .on("end", () => {
                                console.log("[STEP 4] Merge complete.");
                                finalVideoPath = mergedTmp.name;
                                resolve();
                            })
                            .on("error", (err) => {
                                console.error("[ERROR] Merge failed:", err.message);
                                reject(err);
                            });
                    });
                } else {
                    finalMusicId = null; // Music doc not found
                }
            }

            // --- Step 5: Upload final processed video to S3 ---
            console.log("[STEP 5] Uploading final video to S3.");
            const finalBuffer = fs.readFileSync(finalVideoPath);
            const videoUrl = await uploadToS3({
                buffer: finalBuffer,
                originalname: `reel-${Date.now()}.mp4`,
                mimetype: "video/mp4",
            }, "videos");

            // --- Step 6: Handle and upload thumbnail ---
            console.log("[STEP 6] Handling thumbnail.");
            let thumbnailUrl = null;
            if (thumbFile) {
                thumbnailUrl = await uploadToS3(thumbFile, "thumbnails");
            } else {
                // Generate thumbnail from the first second of the final video
                const thumbTmp = tmp.fileSync({ postfix: ".jpg" });
                tempFiles.push(thumbTmp);
                await new Promise((resolve, reject) => {
                    ffmpeg(finalVideoPath)
                        .screenshots({
                            timestamps: [0], // Take screenshot at the beginning
                            filename: path.basename(thumbTmp.name),
                            folder: path.dirname(thumbTmp.name),
                            size: "640x?",
                        })
                        .on("end", resolve)
                        .on("error", reject);
                });
                const thumbBuffer = fs.readFileSync(thumbTmp.name);
                thumbnailUrl = await uploadToS3({
                    buffer: thumbBuffer,
                    originalname: `thumb-${Date.now()}.jpg`,
                    mimetype: "image/jpeg",
                }, "thumbnails");
            }

            // --- Step 7: Save reel metadata to database ---
            console.log("[STEP 7] Saving reel to database.");
            const newReel = new Reel({
                user,
                userid,
                username,
                videoUrl,
                thumbnailUrl,
                caption,
                music: finalMusicId,
            });
            const savedReel = await newReel.save();

            console.log("===== [FULL UPLOAD SUCCESS] =====");
            res.status(201).json({
                message: "Reel uploaded successfully!",
                success: true,
                data: savedReel,
            });

        } catch (err) {
            console.error("===== [FULL UPLOAD ERROR] =====");
            console.error(err);
            res.status(500).json({ success: false, message: "Server error during reel upload." });
        } finally {
            // --- Final Step: Cleanup all temporary files ---
            console.log("-> Cleaning up temporary files.");
            tempFiles.forEach((t) => {
                try {
                    if (t) t.removeCallback();
                } catch (cleanupErr) {
                    console.warn("Warning: Could not remove temp file.", cleanupErr.message)
                }
            });
        }
    }
);


router.post("/", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "No file uploaded",
                success: false
            });
        }

        const folder = req.body.folder || "uploads";

        // ✅ Check if uploaded file is video
        if (req.file.mimetype.startsWith("video/")) {
            // Save uploaded buffer to a temp file
            const inputTmp = tmp.fileSync({ postfix: path.extname(req.file.originalname) });
            fs.writeFileSync(inputTmp.name, req.file.buffer);

            // Create another temp file for compressed video
            const outputTmp = tmp.fileSync({ postfix: ".mp4" });

            // Run ffmpeg compression
            await new Promise((resolve, reject) => {
                ffmpeg(inputTmp.name)
                    .outputOptions([
                        "-c:v libx264",
                        "-preset veryfast",
                        "-crf 28",
                        "-b:v 800k",
                        "-c:a aac",
                        "-b:a 128k"
                    ])
                    .save(outputTmp.name)
                    .on("end", resolve)
                    .on("error", reject);
            });

            // Read compressed file back into buffer
            const compressedBuffer = fs.readFileSync(outputTmp.name);

            // Upload to S3
            const uploadedFileUrl = await uploadToS3(
                { buffer: compressedBuffer, originalname: "compressed-" + req.file.originalname, mimetype: "video/mp4" },
                folder
            );

            // Cleanup
            inputTmp.removeCallback();
            outputTmp.removeCallback();

            console.log("video", uploadedFileUrl)
            return res.status(200).json({
                message: "Video compressed & uploaded successfully!",
                success: true,
                file: uploadedFileUrl
            });

        } else {
            // ✅ If file is NOT a video, upload directly
            const uploadedFileUrl = await uploadToS3(req.file, folder);
            console.log("image", uploadedFileUrl)

            return res.status(200).json({
                message: "File uploaded successfully!",
                success: true,
                file: uploadedFileUrl
            });
        }

    } catch (error) {
        console.error("Error on file upload:", error);
        res.status(500).json({
            message: "Error on file upload!",
            success: false
        });
    }
});




router.post("/upload", async (req, res) => {
    console.log("sd")
    try {
        const data = await req.body;

        if (!data.user || !data.videoUrl) {
            res.status(400).json({ message: "User ID or Video Url missing!" });
        }

        const newReel = new Reel(
            data
        );

        const savedReel = await newReel.save();

        // Safely log user action (even if log fails, app continues)
        try {

            await logUserAction({
                user: savedReel.user,
                action: "upload_reel",
                targetType: "Reel",
                targetId: savedReel._id,
                device: req.headers["user-agent"],
                location: {
                    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                    country: req.headers["cf-ipcountry"] || "",
                    city: "", // Optional: Use IP geolocation later
                    pincode: ""
                }
            });
        } catch (logError) {
            console.error("Log error (non-blocking):", logError.message);
        }
        res.status(201).json({
            message: "Reels Saved Successfully",
            data: {
                id: savedReel._id,
                savedReel
            }
        });


    } catch (error) {
        res.status(500).json({ message: "An Error occure in Upload Reel!" });
        console.log("Error in upload reel", error);
    }
});

router.get("/by-music/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || id === "null" || id === "undefined") {
            return res.status(400).json({ message: "Valid Music ID is required" });
        }

        // Find reels that use this music
        const reels = await Reel.find({ music: id })
            .populate("music") // populate music details
            .populate("user", "username") // optional: populate user info
            .populate("comments"); // optional: populate comments

        if (!reels || reels.length === 0) {
            return res.status(404).json({ message: "No reels found for this music" });
        }

        return res.status(200).json({
            message: "Reels fetched successfully",
            data: reels
        });

    } catch (error) {
        console.error("Error fetching reels by music:", error);
        return res.status(500).json({ message: "Error fetching reels", error: error.message });
    }
});
router.get("/", async (req, res) => {
    try {
        const reels = await Reel.find({});
        res.status(200).json(reels);

    } catch (error) {
        res.status(500).json({ message: "Error to fetching data" });

        console.log("Error to Fetching Data", error)
    }
});
router.get("/show", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || "1", 10);
        const exclude = req.query.exclude?.split(",").filter(Boolean) || [];

        const matchStage = exclude.length
            ? { _id: { $nin: exclude.map((id) => new mongoose.Types.ObjectId(id)) } }
            : {};

        const reels = await Reel.aggregate([
            { $match: matchStage },
            { $sample: { size: limit } }, // still returns random reel(s)
        ]);

        return res.status(200).json({ reels });
    } catch (error) {
        console.error("Error fetching reels:", error);
        return res.status(500).json({ message: "Error fetching reels" });
    }
});
router.get("/shownew", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || "1", 10);
        const exclude = req.query.exclude?.split(",").filter(Boolean) || [];
        const currentUserId = req.query.userId;

        if (!currentUserId) {
            return res.status(400).json({ message: "Missing userId" });
        }

        const matchStage = exclude.length
            ? { _id: { $nin: exclude.map(id => new mongoose.Types.ObjectId(id)) } }
            : {};

        const reels = await Reel.aggregate([
            { $match: matchStage },
            { $sample: { size: limit } }
        ]);

        const reelsWithFollowStatus = await Promise.all(
            reels.map(async (reel) => {
                const isFollowing = await User.exists({
                    _id: reel.user,
                    followers: new mongoose.Types.ObjectId(currentUserId),
                });
                return {
                    ...reel,
                    isFollowing: !!isFollowing, // true or false
                };
            })
        );

        return res.status(200).json({ reels: reelsWithFollowStatus });
    } catch (error) {
        console.error("Error fetching reels:", error);
        return res.status(500).json({ message: "Error fetching reels" });
    }
});

router.post("/view", async (req, res) => {
    try {
        const { reelId, userId } = req.body;

        if (!reelId || !userId) {
            return res.status(400).json({ message: "reelId and userId are required" });
        }

        if (!mongoose.isValidObjectId(reelId) || !mongoose.isValidObjectId(userId)) {
            return res.status(400).json({ message: "Invalid reelId or userId" });
        }

        // Atomically add user to viewsdata only if not present, and increment views only in that case
        const updated = await Reel.findOneAndUpdate(
            { _id: reelId, viewsdata: { $ne: userId } },
            { $addToSet: { viewsdata: userId }, $inc: { views: 1 } },
            { new: true }
        );

        if (!updated) {
            // Either reel not found, or user already counted (can't distinguish without another query)
            const reelExists = await Reel.exists({ _id: reelId });
            if (!reelExists) return res.status(404).json({ message: "Reel not found" });
            return res.status(200).json({ message: "View already counted" });
        }

        return res.status(200).json({
            message: "View added",
            views: updated.views,
        });
    } catch (error) {
        console.error("Error incrementing reel view:", error);
        res.status(500).json({ message: "Error incrementing reel view" });
    }
});



router.get("/:id", async (req, res) => {
    try {
        const video = await Reel.findById(req.params.id);
        if (!video) { res.status(404).json({ message: "video not found!" }) };
        res.status(200).json(video);
    } catch (error) {
        res.status(500).json({ message: "Error to Finding Video" });
        console.log("Error to find video", error);
    }
});

//delete video
router.delete("/delete/:id", async (req, res) => {
    try {

        // Safely log user action (even if log fails, app continues)
        try {
            const reel = await Reel.findById(req.params.id);
            await logUserAction({
                user: reel.user,
                action: "delete_reel",
                targetType: "Reel",
                targetId: req.params.id,
                device: req.headers["user-agent"],
                location: {
                    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                    country: req.headers["cf-ipcountry"] || "",
                    city: "", // Optional: Use IP geolocation later
                    pincode: ""
                }
            });
        } catch (logError) {
            console.error("Log error (non-blocking):", logError.message);
        }

        await Reel.findByIdAndDelete(req.params.id);




        res.status(200).json({ message: "Video Deleted Successfully!" });
    } catch (error) {
        console.log("Error in Delete video", error);
        res.status(500).json({ message: "Error in delete video" });
    }
});

router.put("/update/:id", async (req, res) => {
    try {
        const { videoUrl, thumbnailUrl, caption, duration, music } = await req.body;
        const video = await Reel.findById(req.params.id);
        if (!video) { res.status(404).json({ message: "Video not found!" }) };
        if (videoUrl) { video.videoUrl = videoUrl };
        if (thumbnailUrl) { video.thumbnailUrl = thumbnailUrl };
        if (caption) { video.caption = caption };
        if (duration) { video.duration = duration };
        if (music) { video.music = music };

        const updatedReel = await video.save();


        // Safely log user action (even if log fails, app continues)
        try {
            await logUserAction({
                user: video.user,
                action: "update_reel",
                targetType: "Reel",
                targetId: req.params.id,
                device: req.headers["user-agent"],
                location: {
                    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                    country: req.headers["cf-ipcountry"] || "",
                    city: "", // Optional: Use IP geolocation later
                    pincode: ""
                }
            });
        } catch (logError) {
            console.error("Log error (non-blocking):", logError.message);
        }
        res.status(200).json({
            _id: updatedReel._id,
            videoUrl: updatedReel.videoUrl,
            thumbnailUrl: updatedReel.thumbnailUrl,
            caption: updatedReel.caption,
            duration: updatedReel.duration,
            music: updatedReel.music,
        });


    } catch (error) {
        res.status(500).json({
            message: "Error in updation!"
        });
        console.log("Error in updateion reel", error);
    }
});

// Like or Unlike a Reel
router.put("/like/:id", async (req, res) => {
    try {
        const { userId } = req.body;
        const reelId = req.params.id;

        if (!userId) {
            return res.status(400).json({ message: "User ID is required" });
        }

        const reel = await Reel.findById(reelId);
        if (!reel) {
            return res.status(404).json({ message: "Reel not found" });
        }

        const alreadyLiked = reel.likes.includes(userId);

        // Safely log user action (even if log fails, app continues)
        try {
            await logUserAction({
                user: userId,
                action: alreadyLiked ? "unlike_reel" : "like_reel",
                targetType: "Reel",
                targetId: reelId,
                device: req.headers["user-agent"],
                location: {
                    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                    country: req.headers["cf-ipcountry"] || "",
                    city: "", // Optional: Use IP geolocation later
                    pincode: ""
                }
            });
        } catch (logError) {
            console.error("Log error (non-blocking):", logError.message);
        }
        if (alreadyLiked) {
            // If already liked, remove the like
            reel.likes = reel.likes.filter((id) => id.toString() !== userId);
            await reel.save();
            return res.status(200).json({ message: "Reel unliked", likes: reel.likes.length });

        } else {
            // If not liked, add the like
            reel.likes.push(userId);
            await reel.save();
            return res.status(200).json({ message: "Reel liked", likes: reel.likes.length });
        }

    } catch (error) {
        console.log("Error in liking/unliking reel:", error);
        res.status(500).json({ message: "Something went wrong" });
    }
});

router.put("/:id/share", async (req, res) => {
    try {
        const { sharedBy, sharedTo } = req.body;

        if (!sharedBy || !sharedTo) {
            return res.status(400).json({ message: "Missing sharedBy or sharedTo" });
        }

        const reel = await Reel.findById(req.params.id);
        if (!reel) return res.status(404).json({ message: 'Reel not found' });


        reel.shares.push({ sharedBy, sharedTo });

        await reel.save();
        // Safely log user action (even if log fails, app continues)
        try {
            await logUserAction({
                user: sharedBy,
                action: "share_reel",
                targetType: "Reel",
                targetId: req.params.id,
                device: req.headers["user-agent"],
                location: {
                    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                    country: req.headers["cf-ipcountry"] || "",
                    city: "", // Optional: Use IP geolocation later
                    pincode: ""
                }
            });
        } catch (logError) {
            console.error("Log error (non-blocking):", logError.message);
        }
        res.status(200).json({ message: "Reel shared successfully" });

    } catch (error) {
        console.error("Error sharing reel:", error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;
