const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instagram Video URL Extractor</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gradient-to-br from-purple-50 to-pink-50 min-h-screen">
    <header class="bg-white shadow-md">
        <div class="container mx-auto px-4 py-6">
            <h1 class="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
                📥 Instagram Video URL Extractor
            </h1>
            <p class="text-gray-600 mt-2">Get direct video URLs from Instagram posts</p>
        </div>
    </header>

    <main class="container mx-auto px-4 py-8 max-w-4xl">
        <div class="bg-white rounded-lg shadow-xl p-8 mb-8">
            <h2 class="text-2xl font-semibold text-gray-800 mb-4">How to Use</h2>
            <div class="space-y-4 text-gray-700">
                <div class="flex items-start">
                    <span class="text-2xl mr-3">1️⃣</span>
                    <p>Paste an Instagram post URL (e.g., <code class="bg-gray-100 px-2 py-1 rounded">https://www.instagram.com/p/...</code>)</p>
                </div>
                <div class="flex items-start">
                    <span class="text-2xl mr-3">2️⃣</span>
                    <p>Click "Get Video URL" to extract the direct video URL</p>
                </div>
                <div class="flex items-start">
                    <span class="text-2xl mr-3">3️⃣</span>
                    <p>Use the returned URL to access the video directly</p>
                </div>
            </div>
        </div>

        <div class="bg-white rounded-lg shadow-xl p-8 mb-8">
            <h2 class="text-2xl font-semibold text-gray-800 mb-6">Try It Out</h2>
            <form id="downloadForm" class="space-y-4">
                <div>
                    <label for="url" class="block text-sm font-medium text-gray-700 mb-2">
                        Instagram URL
                    </label>
                    <input
                        type="url"
                        id="url"
                        name="url"
                        placeholder="https://www.instagram.com/p/..."
                        required
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                    />
                </div>
                <button
                    type="submit"
                    id="submitBtn"
                    class="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-purple-700 hover:to-pink-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                    Get Video URL
                </button>
            </form>

            <div id="result" class="mt-6 hidden">
                <div class="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <h3 class="text-lg font-semibold text-gray-800 mb-2">Result:</h3>
                    <div id="resultContent" class="space-y-3"></div>
                </div>
            </div>

            <div id="loading" class="mt-6 hidden text-center">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                <p class="mt-2 text-gray-600">Processing...</p>
            </div>
        </div>

        <div class="bg-white rounded-lg shadow-xl p-8">
            <h2 class="text-2xl font-semibold text-gray-800 mb-4">API Documentation</h2>
            <div class="space-y-4 text-gray-700">
                <div>
                    <h3 class="font-semibold text-gray-800 mb-2">Endpoint:</h3>
                    <code class="bg-gray-100 px-3 py-2 rounded block">POST /download</code>
                </div>
                <div>
                    <h3 class="font-semibold text-gray-800 mb-2">Request Body:</h3>
                    <pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto"><code>{
  "url": "https://www.instagram.com/p/..."
}</code></pre>
                </div>
                <div>
                    <h3 class="font-semibold text-gray-800 mb-2">Response:</h3>
                    <pre class="bg-gray-100 p-4 rounded-lg overflow-x-auto"><code>{
  "url": "https://scontent.cdninstagram.com/v/..."
}</code></pre>
                </div>
            </div>
        </div>
    </main>

    <script>
        const form = document.getElementById('downloadForm');
        const submitBtn = document.getElementById('submitBtn');
        const resultDiv = document.getElementById('result');
        const resultContent = document.getElementById('resultContent');
        const loadingDiv = document.getElementById('loading');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const url = document.getElementById('url').value;
            
            // Show loading, hide result
            loadingDiv.classList.remove('hidden');
            resultDiv.classList.add('hidden');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';

            try {
                const response = await fetch('/download', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url }),
                });

                const data = await response.json();

                if (response.ok) {
                    resultContent.innerHTML = \`
                        <div class="space-y-4">
                            <div>
                                <h4 class="text-sm font-semibold text-gray-700 mb-2">Video Preview:</h4>
                                <div class="bg-black rounded-lg overflow-hidden">
                                    <video
                                        controls
                                        class="w-full max-h-96"
                                        id="videoPlayer"
                                    >
                                        <source src="\${data.url}" type="video/mp4">
                                        Your browser does not support the video tag.
                                    </video>
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button
                                    onclick="downloadVideo('\${data.url}')"
                                    class="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-green-700 hover:to-emerald-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition transform hover:scale-105 flex items-center justify-center gap-2"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                                    </svg>
                                    Download Video
                                </button>
                                <button
                                    onclick="copyToClipboard('\${data.url}')"
                                    class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                    </svg>
                                    Copy URL
                                </button>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500 mb-1">Video URL:</p>
                                <input
                                    type="text"
                                    value="\${data.url}"
                                    readonly
                                    class="w-full px-3 py-2 bg-white border border-gray-300 rounded text-xs"
                                    id="videoUrl"
                                />
                            </div>
                        </div>
                    \`;
                    resultDiv.classList.remove('hidden');
                } else {
                    resultContent.innerHTML = \`
                        <div class="bg-red-50 border border-red-200 rounded p-3">
                            <p class="text-red-800 font-semibold">Error:</p>
                            <p class="text-red-600 text-sm mt-1">\${data.error || 'Unknown error'}</p>
                            \${data.details ? \`<p class="text-red-500 text-xs mt-1">\${data.details}</p>\` : ''}
                        </div>
                    \`;
                    resultDiv.classList.remove('hidden');
                }
            } catch (error) {
                resultContent.innerHTML = \`
                    <div class="bg-red-50 border border-red-200 rounded p-3">
                        <p class="text-red-800 font-semibold">Error:</p>
                        <p class="text-red-600 text-sm mt-1">\${error.message}</p>
                    </div>
                \`;
                resultDiv.classList.remove('hidden');
            } finally {
                loadingDiv.classList.add('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Get Video URL';
            }
        });

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                const btn = event.target.closest('button');
                const originalText = btn.innerHTML;
                btn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!';
                btn.classList.add('bg-green-600', 'hover:bg-green-700');
                btn.classList.remove('bg-purple-600', 'hover:bg-purple-700');
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.remove('bg-green-600', 'hover:bg-green-700');
                    btn.classList.add('bg-purple-600', 'hover:bg-purple-700');
                }, 2000);
            });
        }

        function downloadVideo(url) {
            const link = document.createElement('a');
            link.href = url;
            link.download = 'instagram-video.mp4';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    </script>
</body>
</html>
  `);
});

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
