const express = require("express");
const Music = require("../models/Music");
const router = express.Router();


router.post("/new", async (req, res) => {

    try {
        const { title, artist, url, duration, uploadedBy, thumbnail } = req.body;

        if (!title || !url) {

            return res.status(400).json({ meeaage: "Somethink Error Found in Music To Upload Data Proper" });
        }

        const newMusic = new Music(
            {
                title,
                artist,
                url,
                duration,
                uploadedBy,
                thumbnail
            }
        );

        const saveMusic = await newMusic.save();

        return res.status(200).json({
            message: "Music Saved Successfully",
            data: saveMusic._id
        });
    } catch (error) {
        console.log("Error", error);
        return res.status(400).json({
            message: "Error Found in Upload Music"
        });
    }


});
router.get("/", async (req, res) => {
    try {
        const musics = await Music.find({});

        return res.status(200).json({ message: "Data Fetched Successfully", data: musics });

    } catch (error) {
        return res.status(400).json({ message: "error occure" });
        console.log("Error in", error);
    }
});
router.get("/search", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const music = await Music.find({
            $or: [
                { title: { $regex: q, $options: "i" } },
                { artist: { $regex: q, $options: "i" } }
            ]
        }).limit(10);

        res.json(music);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});


//find single music 
router.get("/:id", async (req, res) => {
    try {

        const music = await Music.findById(req.params.id);
        if (!music) return res.status(404).json({ message: "Music not found" });
        res.json(music);
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

//delete single user 
router.delete("/delete/:id", async (req, res) => {
    try {
        await Music.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: "Music deleted successfully" });

    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

router.put("/update/:id", async (req, res) => {
    const { title, artist, thumbnail } = await req.body;
    try {
        const music = await Music.findById(req.params.id);
        if (!music) { res.status(404).json({ message: "Music not found" }) };

        if (title) music.title = title;
        if (artist) music.artist = artist;
        if (thumbnail) music.thumbnail = thumbnail;

        const musicSave = await music.save();

        res.status(201).json(
            {
                message: "Update Music",
                title: musicSave.title,
                artist: musicSave.artist,
                id: musicSave._id
            }
        );

    } catch (error) {
        res.status(500).json({ message: "Error to Update music" });
        console.log(error);
    }
});

module.exports = router;