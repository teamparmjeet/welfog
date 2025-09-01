const { Worker } = require("bullmq");
const Redis = require("ioredis");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const fs = require("fs");
const path = require("path");
const tmp = require("tmp");
const { s3, getFileFromS3, uploadToS3 } = require("./lib/s3");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const connection = new Redis();

const worker = new Worker("video-processing", async job => {
  console.log("Processing job:", job.id);

  const { fileKey, originalName, folder } = job.data;

  // Download from S3
  const inputTmp = tmp.fileSync({ postfix: path.extname(originalName) });
  const outputTmp = tmp.fileSync({ postfix: ".mp4" });
  await getFileFromS3(fileKey, inputTmp.name);

  // Compress video
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

  // Upload compressed file
  const compressedBuffer = fs.readFileSync(outputTmp.name);
  const compressedUrl = await uploadToS3(
    { buffer: compressedBuffer, originalname: "compressed-" + originalName },
    folder
  );

  console.log("Compressed file uploaded:", compressedUrl);

  // Cleanup
  inputTmp.removeCallback();
  outputTmp.removeCallback();

  return { compressedUrl };
}, { connection });

console.log("Worker running for video-processing queue...");
