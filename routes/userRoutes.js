const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/Users");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const logUserAction = require("../utils/logUserAction");
const Reel = require("../models/Reel")
const router = express.Router();


router.post("/", async (req, res) => {
    try {
        const { userid, username, mobile, email, profilePicture, bio } = req.body;
        console.log(req.body);

        // ✅ Validate required fields
        if (!userid || !mobile) {
            return res.status(400).json({ message: "User ID and mobile no are required" });
        }

        // ✅ Check if userid already exists
        const existingUser = await User.findOne({ userid });
        if (existingUser) {
            // Instead of error, return existing user data
            return res.status(200).json({
                message: "User already registered",
                _id: existingUser._id,
                userid: existingUser.userid,
                username: existingUser.username,
                mobile: existingUser.mobile,
                email: existingUser.email,
                profilePicture: existingUser.profilePicture,
                bio: existingUser.bio,
                followers: existingUser.followers,
                following: existingUser.following,
                isSuspended: existingUser.isSuspended,
                createdAt: existingUser.createdAt,
            });
        }

        // ✅ Create user
        const newUser = new User({
            userid,
            username: username || "",
            mobile: mobile || "",
            email: email || "",
            profilePicture: profilePicture || "",
            bio: bio || "",
        });

        const savedUser = await newUser.save();

        // ✅ Response for newly created user
        res.status(201).json({
            message: "User registered successfully",
            _id: savedUser._id,
            userid: savedUser.userid,
            username: savedUser.username,
            mobile: savedUser.mobile,
            email: savedUser.email,
            profilePicture: savedUser.profilePicture,
            bio: savedUser.bio,
            followers: savedUser.followers,
            following: savedUser.following,
            isSuspended: savedUser.isSuspended,
            createdAt: savedUser.createdAt,
        });

    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ message: "Server error" });
    }
});





// router.get("/", async (req, res) => {
//     try {
//         const users = await User.find({}, '-passwordHash'); // Exclude passwordHash
//         res.status(200).json(users);
//     } catch (error) {
//         console.error("Error fetching users:", error);
//         res.status(500).json({ message: "Server error" });
//     }
// });


//login user

router.post("/login", async (req, res) => {
    const { mobile } = req.body;

    try {
        // Find user by mobile number
        const user = await User.findOne({ mobile });
        if (!user) return res.status(400).json({ message: "User not found with this mobile number" });

        // Optional: You could add device/IP-based validation here if needed

        // Prepare JWT payload
        const payload = {
            user: {
                id: user._id,
                username: user.username
            }
        };

        // Log the login action (non-blocking)
        try {
            await logUserAction({
                user: user._id,
                action: "login",
                targetType: "User",
                targetId: user._id,
                device: req.headers["user-agent"],
                location: {
                    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
                    country: req.headers["cf-ipcountry"] || "",
                    city: "",
                    pincode: ""
                }
            });
        } catch (logError) {
            console.error("Log error (non-blocking):", logError.message);
        }

        // Sign JWT token
        jwt.sign(payload, JWT_SECRET, (err, token) => {
            if (err) {
                console.error("JWT signing error:", err);
                return res.status(500).json({ message: "Error generating token." });
            }

            // Send back user data and token
            res.json({
                message: "Login successful!",
                token: token,
                user: {
                    _id: user._id,
                    username: user.username,
                    mobile: user.mobile,
                    profilePicture: user.profilePicture,
                    bio: user.bio,
                }
            });
        });

    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ message: "Server error" });
    }
});



//find single user 
router.get("/:id", async (req, res) => {
    try {
        // Step 1: Fetch the user (excluding password)
        const user = await User.findOne({ userid: req.params.id }).select("-passwordHash");
        if (!user) return res.status(404).json({ message: "User not found" });

        // Step 2: Count how many reels this user has posted
        const postCount = await Reel.countDocuments({ userid: req.params.id });

        // Step 3: Return both user info and post count
        res.json({
            ...user.toObject(), // convert Mongoose doc to plain object to add extra field
            postCount,
        });
    } catch (err) {
        console.error("Error fetching user data:", err);
        res.status(500).json({ message: "Server error123" });
    }
});
router.get("/userpost/:id", async (req, res) => {
    try {
        // Step 1: Fetch user (excluding passwordHash)
        const user = await User.findById(req.params.id).select("-passwordHash");
        if (!user) return res.status(404).json({ message: "User not found" });

        // Step 2: Get latest 30 reels of this user
        const reels = await Reel.find({ user: req.params.id })
            .sort({ createdAt: -1 })
            .limit(30);

        // Step 3: Return user data + reel list + count
        res.json({
            ...user.toObject(),
            postCount: await Reel.countDocuments({ user: req.params.id }), // total count
            reels, // latest 30 reels
        });

    } catch (err) {
        console.error("Error fetching user and reels:", err);
        res.status(500).json({ message: "Server error" });
    }
});

router.get("/userlikedposts/:id", async (req, res) => {
    try {
        const userId = req.params.id;

        // Find reels where this userId exists in the likes array
        const likedReels = await Reel.find({ likes: userId })
            .sort({ createdAt: -1 })
            .limit(30) // latest 30 liked reels
            .populate('user', 'username profilePicture'); // optional: include poster info

        res.json({
            count: likedReels.length,
            reels: likedReels,
        });

    } catch (err) {
        console.error("Error fetching user's liked reels:", err);
        res.status(500).json({ message: "Server error" });
    }
});

router.get("/bymobile/:mobile", async (req, res) => {
    try {

        const user = await User.findOne({ mobile: req.params.mobile }).select("-passwordHash");

        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});
router.get("/byemailapp/:email", async (req, res) => {
    try {

        const user = await User.findOne({ email: req.params.email });

        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// delete user
router.delete("/:id", async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: "User deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// follow to user 

router.put("/:id/follow", async (req, res) => {
    const { userId } = req.body; // ID of the user who is following
    if (userId === req.params.id) {
        return res.status(400).json({ message: "You can't follow yourself" });
    }

    try {
        const userToFollow = await User.findById(req.params.id);
        const currentUser = await User.findById(userId);

        if (!userToFollow || !currentUser) {
            return res.status(404).json({ message: "User not found" });
        }


        if (!userToFollow.followers.includes(userId)) {
            userToFollow.followers.push(userId);
            currentUser.following.push(req.params.id);
            await userToFollow.save();
            await currentUser.save();

            // Safely log user action (even if log fails, app continues)
            try {

                await logUserAction({
                    user: userId,
                    action: "follow_user",
                    targetType: "User",
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


            res.json({ message: "User followed" });


        } else {
            res.status(400).json({ message: "Already following" });
        }
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});


// unfollow user 

router.put("/:id/unfollow", async (req, res) => {
    const { userId } = req.body;
    try {
        const userToUnfollow = await User.findById(req.params.id);
        const currentUser = await User.findById(userId);

        if (!userToUnfollow || !currentUser) {
            return res.status(404).json({ message: "User not found" });
        }

        if (userToUnfollow.followers.includes(userId)) {
            userToUnfollow.followers.pull(userId);
            currentUser.following.pull(req.params.id);
            await userToUnfollow.save();
            await currentUser.save();

            // Safely log user action (even if log fails, app continues)
            try {

                await logUserAction({
                    user: userId,
                    action: "unfollow_user",
                    targetType: "User",
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
            res.json({ message: "User unfollowed" });
        } else {
            res.status(400).json({ message: "You are not following this user" });
        }
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});


// update user

router.put("/:id", async (req, res) => {
    const { username, profilePicture, bio, currentPassword, newPassword, isSuspended } = req.body;

    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        // Update password if needed
        if (currentPassword && newPassword) {
            const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
            if (!isMatch) return res.status(400).json({ message: "Current password is incorrect" });

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            user.passwordHash = hashedPassword;
        }

        // Update other fields
        if (username) user.username = username;
        if (profilePicture) user.profilePicture = profilePicture;
        if (bio) user.bio = bio;
        if (typeof isSuspended === 'boolean') user.isSuspended = isSuspended;

        const updatedUser = await user.save();

        res.json({
            _id: updatedUser._id,
            username: updatedUser.username,
            email: updatedUser.email,
            profilePicture: updatedUser.profilePicture,
            bio: updatedUser.bio,
            isSuspended: updatedUser.isSuspended,
            createdAt: updatedUser.createdAt,
        });
    } catch (err) {
        console.error("Update error:", err);
        res.status(500).json({ message: "Server error" });
    }
});



module.exports = router;