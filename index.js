const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

app.post('/download', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Instagram URL missing' });
  }

  const cmd = `yt-dlp -f "best[ext=mp4]/best" --get-url --no-download "${url}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', error);
      console.error('Stderr:', stderr);
      return res.status(500).json({ error: 'Failed to get video URL', details: stderr });
    }

    const videoUrl = stdout.trim();
    if (!videoUrl || !videoUrl.startsWith('http')) {
      console.error('Invalid URL received:', videoUrl);
      return res.status(500).json({ error: 'No valid video URL found' });
    }

    res.json({
      url: videoUrl
    });
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ IG Downloader running on port ${PORT}`);
});
