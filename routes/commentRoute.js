const express = require("express");
const router = express.Router();
const Comment = require("../models/Comment");
const User = require("../models/Users");
const Reel2 = require("../models/Reel"); // This is your Reel model

router.post("/new", async (req, res) => {
  try {
    const { user, reel, text, parentComment } = req.body;

    if (!user || !reel || !text) {
      return res.status(400).json({
        message: "Missing user, reel, or comment text.",
      });
    }

    // 1. Create new comment
    const comment = new Comment({
      user,
      reel,
      text,
      parentComment: parentComment || null,
    });

    // 2. Save comment
    const savedComment = await comment.save();

    // 3. Add comment ID to the corresponding Reel
    await Reel2.findByIdAndUpdate(
      reel,
      { $push: { comments: savedComment._id } }, // Use $addToSet to avoid duplicates
      { new: true }
    );

    // 4. Respond with saved comment
    res.status(201).json(savedComment);
  } catch (error) {
    console.error("Comment creation error:", error);
    res.status(500).json({ message: "Error occurred in Comment creation" });
  }
});

router.get("/", async (req, res) => {
  try {
    const comments = await Comment.find({});
    res.status(200).json(comments);

  } catch (error) {
    res.status(500).json({ message: "Error to fetching data" });

    console.log("Error to Fetching Data", error)
  }
  // console.log("Hello");
});

// find single comment 
router.get("/:id", async (req, res) => {
  try {
    const data = await Comment.findById(req.params.id);
    if (!data) {
      res.status(404).json({ message: "Comment not found" });
    };
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: "Error to fetching data" });

    console.log("Error to Fetching Data", error)
  }
});

// delete comment 
router.delete("/delete/:id", async (req, res) => {
  try {
    await Comment.deleteMany({ parentComment: req.params.id });
    await Comment.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Comment Deleted Successfully!" });
  } catch (error) {
    console.log("Error in Delete Comment", error);
    res.status(500).json({ message: "Error in Comment video" });
  }
});

//update comment
router.put("/update/:id", async (req, res) => {
  try {
    const { text } = await req.body;
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      res.status(404).json({ message: "Comment Not Found to edit!" });
    }

    comment.text = text;

    const savedComment = await comment.save();
    res.status(201).json(
      savedComment
    );
  } catch (error) {
    console.log("Error in Update Comment", error);
    res.status(500).json({ message: "Error in Comment" });
  }
});


// GET comments for a reel
router.get('/reel/:reelId', async (req, res) => {
  try {
    const reelId = req.params.reelId;

    const comments = await Comment.find({ reel: reelId, parentComment: null })
      .populate('user', 'username profilePicture')
      .sort({ createdAt: -1 });

    const commentsWithReplies = await Promise.all(
      comments.map(async (comment) => {
        const replies = await Comment.find({ parentComment: comment._id })
          .populate('user', 'username profilePicture')
          .sort({ createdAt: 1 });

        return { ...comment._doc, replies };
      })
    );

    return res.status(200).json(commentsWithReplies); // ✅ return here to prevent further execution
  } catch (error) {
    console.error("Error fetching comments:", error);

    // ✅ Don't send response if already sent
    if (!res.headersSent) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  }
});



// comment like dislike
router.put("/like/:id", async (req, res) => {
  try {
    const { userId } = req.body;
    const commentId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ message: "comment not found" });
    }

    const alreadyLiked = comment.likes.includes(userId);

    if (alreadyLiked) {
      // If already liked, remove the like
      comment.likes = comment.likes.filter((id) => id.toString() !== userId);
      await comment.save();
      return res.status(200).json({ message: "comment Disliked", likes: comment.likes.length });
    } else {
      // If not liked, add the like
      comment.likes.push(userId);
      await comment.save();
      return res.status(200).json({ message: "comment liked", likes: comment.likes.length });
    }

  } catch (error) {
    console.log("Error in liking/Disliking comment:", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});


module.exports = router;
