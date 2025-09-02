const express = require("express");
const mongoose = require('mongoose');
const router = express.Router();
const Reel = require("../models/Reel");
const User = require("../models/Users");
const multer = require("multer");
const logUserAction = require("../utils/logUserAction");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const tmp = require("tmp");
const { uploadToS3 } = require("../lib/s3");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);


const upload = multer({ storage: multer.memoryStorage() });

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

      console.log("video",uploadedFileUrl)
      return res.status(200).json({
        message: "Video compressed & uploaded successfully!",
        success: true,
        file: uploadedFileUrl
      });

    } else {
      // ✅ If file is NOT a video, upload directly
      const uploadedFileUrl = await uploadToS3(req.file, folder);
      console.log("image",uploadedFileUrl)

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

router.get("/view/:id", async (req, res) => {
    try {
        const updated = await Reel.findByIdAndUpdate(
            req.params.id,
            { $inc: { views: 1 } }
        );

        if (!updated) {
            return res.status(404).json({ message: "Video not found!" });
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("Error incrementing video view:", error);
        res.status(500).json({ message: "Error incrementing video view" });
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
