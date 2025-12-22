// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(express.json());

// Cloudflare R2 Configuration (all values must come from environment variables)
const R2_CONFIG = {
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  endpoint: process.env.R2_ENDPOINT,
  region: process.env.R2_REGION || 'auto',
  bucket: process.env.R2_BUCKET,
  publicUrl: process.env.R2_PUBLIC_URL || null, // Optional: Custom public URL domain
  urlExpiration: parseInt(process.env.R2_URL_EXPIRATION || '604800', 10) // Default: 7 days in seconds
};

function ensureR2Config() {
  const missing = [];
  if (!R2_CONFIG.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!R2_CONFIG.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!R2_CONFIG.endpoint) missing.push('R2_ENDPOINT');
  if (!R2_CONFIG.bucket) missing.push('R2_BUCKET');

  if (missing.length) {
    const message = `Missing required Cloudflare R2 env vars: ${missing.join(', ')}`;
    console.error(message);
    throw new Error(message);
  }
}

// Validate configuration at startup
ensureR2Config();

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client({
  region: R2_CONFIG.region,
  endpoint: R2_CONFIG.endpoint,
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
  forcePathStyle: true, // Required for R2
});

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to sanitize metadata values for HTTP headers
// Removes invalid characters that aren't allowed in HTTP header values
function sanitizeMetadata(value) {
  if (!value) return '';
  return String(value)
    .replace(/[\r\n\t]/g, ' ') // Replace newlines, carriage returns, tabs with spaces
    .replace(/[^\x20-\x7E]/g, '') // Remove non-printable ASCII characters
    .trim()
    .substring(0, 1000); // Limit length
}

app.get('/', (req, res) => {
  // Get base URL dynamically
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  
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
            <p class="text-gray-600 mt-2">Get direct video URLs from Instagram posts and upload to Cloudflare R2</p>
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
                    <p>Click "Get Video URL" to download and upload to Cloudflare R2</p>
                </div>
                <div class="flex items-start">
                    <span class="text-2xl mr-3">3️⃣</span>
                    <p>Use the returned URL to access the video directly from R2</p>
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
            <h2 class="text-2xl font-semibold text-gray-800 mb-6">API Documentation</h2>
            
            <!-- Endpoint 1: Download & Upload -->
            <div class="mb-8 pb-8 border-b border-gray-200">
                <div class="flex items-center gap-2 mb-4">
                    <span class="bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-0.5 rounded">POST</span>
                    <h3 class="text-xl font-semibold text-gray-800">Download & Upload Video</h3>
                </div>
                <div class="space-y-3 mb-4">
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Full Endpoint URL:</p>
                        <code class="bg-gray-100 px-3 py-2 rounded block text-sm break-all">${baseUrl}/download</code>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Description:</p>
                        <p class="text-sm text-gray-700">Downloads a video from Instagram and uploads it to Cloudflare R2. Returns the public URL and file details.</p>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Request Headers:</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>Content-Type: application/json</code></pre>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Request Body:</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>{
  "url": "https://www.instagram.com/p/ABC123xyz/"
}</code></pre>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Success Response (200 OK):</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>{
  "url": "https://pub-1be054bf8960404aa88474df6542beeb.r2.dev/videos/uuid.mp4",
  "r2Key": "videos/uuid.mp4",
  "bucket": "reelbucket",
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Video description text...",
  "title": "Video title",
  "duration": 30,
  "size": 1234567,
  "sizeFormatted": "1.18 MB",
  "uploadedAt": "2024-01-01T00:00:00.000Z",
  "urlExpiresIn": null,
  "urlExpiresAt": null
}</code></pre>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Error Response (400/500):</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>{
  "error": "Instagram URL missing",
  "details": "Additional error details..."
}</code></pre>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">cURL Example:</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>curl -X POST ${baseUrl}/download \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://www.instagram.com/p/ABC123xyz/"}'</code></pre>
                    </div>
                </div>
            </div>

            <!-- Endpoint 2: Get URL -->
            <div class="mb-8 pb-8 border-b border-gray-200">
                <div class="flex items-center gap-2 mb-4">
                    <span class="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded">GET</span>
                    <h3 class="text-xl font-semibold text-gray-800">Get/Regenerate Video URL</h3>
                </div>
                <div class="space-y-3 mb-4">
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Full Endpoint URL:</p>
                        <code class="bg-gray-100 px-3 py-2 rounded block text-sm break-all">${baseUrl}/url/:fileId</code>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Description:</p>
                        <p class="text-sm text-gray-700">Generates or regenerates a presigned URL for an existing video file. Useful if the URL has expired.</p>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">URL Parameters:</p>
                        <ul class="text-sm text-gray-700 list-disc list-inside ml-2">
                            <li><code class="bg-gray-100 px-1 rounded">fileId</code> - The UUID of the file (returned from upload)</li>
                        </ul>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Example Request:</p>
                        <code class="bg-gray-100 px-3 py-2 rounded block text-sm break-all">${baseUrl}/url/550e8400-e29b-41d4-a716-446655440000</code>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Success Response (200 OK):</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>{
  "url": "https://pub-1be054bf8960404aa88474df6542beeb.r2.dev/videos/uuid.mp4",
  "r2Key": "videos/uuid.mp4",
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "urlExpiresIn": null,
  "urlExpiresAt": null
}</code></pre>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">cURL Example:</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>curl -X GET ${baseUrl}/url/550e8400-e29b-41d4-a716-446655440000</code></pre>
                    </div>
                </div>
            </div>

            <!-- Endpoint 3: Delete -->
            <div class="mb-8">
                <div class="flex items-center gap-2 mb-4">
                    <span class="bg-red-100 text-red-800 text-xs font-semibold px-2.5 py-0.5 rounded">DELETE</span>
                    <h3 class="text-xl font-semibold text-gray-800">Delete Video</h3>
                </div>
                <div class="space-y-3 mb-4">
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Full Endpoint URL:</p>
                        <code class="bg-gray-100 px-3 py-2 rounded block text-sm break-all">${baseUrl}/delete/:fileId</code>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Description:</p>
                        <p class="text-sm text-gray-700">Deletes a video file from Cloudflare R2 storage using its fileId.</p>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">URL Parameters:</p>
                        <ul class="text-sm text-gray-700 list-disc list-inside ml-2">
                            <li><code class="bg-gray-100 px-1 rounded">fileId</code> - The UUID of the file to delete</li>
                        </ul>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Example Request:</p>
                        <code class="bg-gray-100 px-3 py-2 rounded block text-sm break-all">${baseUrl}/delete/550e8400-e29b-41d4-a716-446655440000</code>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">Success Response (200 OK):</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>{
  "success": true,
  "message": "File deleted successfully",
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "r2Key": "videos/uuid.mp4",
  "deletedAt": "2024-01-01T00:00:00.000Z"
}</code></pre>
                    </div>
                    <div>
                        <p class="text-sm font-medium text-gray-600 mb-1">cURL Example:</p>
                        <pre class="bg-gray-100 p-3 rounded-lg overflow-x-auto text-xs"><code>curl -X DELETE ${baseUrl}/delete/550e8400-e29b-41d4-a716-446655440000</code></pre>
                    </div>
                </div>
            </div>

            <!-- Status Codes -->
            <div class="mt-8 pt-8 border-t border-gray-200">
                <h3 class="text-lg font-semibold text-gray-800 mb-4">HTTP Status Codes</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div class="flex items-center gap-2">
                        <span class="bg-green-100 text-green-800 font-semibold px-2 py-1 rounded text-xs">200</span>
                        <span class="text-gray-700">Success</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="bg-red-100 text-red-800 font-semibold px-2 py-1 rounded text-xs">400</span>
                        <span class="text-gray-700">Bad Request (missing parameters)</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="bg-red-100 text-red-800 font-semibold px-2 py-1 rounded text-xs">500</span>
                        <span class="text-gray-700">Internal Server Error</span>
                    </div>
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
                            \${data.description ? \`
                            <div>
                                <h4 class="text-sm font-semibold text-gray-700 mb-2">Description:</h4>
                                <div class="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                    <p class="text-sm text-gray-700 whitespace-pre-wrap">\${data.description}</p>
                                </div>
                            </div>
                            \` : ''}
                            <div class="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <p class="text-gray-500">File Size:</p>
                                    <p class="font-semibold">\${data.sizeFormatted || 'N/A'}</p>
                                </div>
                                <div>
                                    <p class="text-gray-500">Duration:</p>
                                    <p class="font-semibold">\${data.duration ? Math.floor(data.duration) + 's' : 'N/A'}</p>
                                </div>
                                <div>
                                    <p class="text-gray-500">File ID:</p>
                                    <p class="font-semibold text-xs">\${data.fileId}</p>
                                </div>
                                <div>
                                    <p class="text-gray-500">Bucket:</p>
                                    <p class="font-semibold">\${data.bucket}</p>
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
                                <button
                                    onclick="deleteFile('\${data.fileId}')"
                                    class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center justify-center gap-2"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                    Delete
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

        async function deleteFile(fileId) {
            if (!confirm('Are you sure you want to delete this file from Cloudflare R2?')) {
                return;
            }

            try {
                const response = await fetch(\`/delete/\${fileId}\`, {
                    method: 'DELETE',
                });

                const data = await response.json();

                if (response.ok) {
                    alert('File deleted successfully!');
                    resultDiv.classList.add('hidden');
                } else {
                    alert('Error: ' + (data.error || 'Failed to delete file'));
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        }
    </script>
</body>
</html>
  `);
});

app.post('/download', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Instagram URL missing' });
  }

  const fileId = uuidv4();
  const localFilePath = path.join(downloadsDir, `${fileId}.mp4`);
  const r2Key = `videos/${fileId}.mp4`;

  try {
    // Get video metadata first
    const metadataCmd = `yt-dlp --dump-json --no-download "${url}"`;
    
    exec(metadataCmd, async (metaError, metaStdout, metaStderr) => {
      let description = '';
      let title = '';
      let duration = 0;
      let fileSize = 0;
      
      if (!metaError && metaStdout) {
        try {
          const metadata = JSON.parse(metaStdout);
          description = metadata.description || metadata.title || '';
          title = metadata.title || '';
          duration = metadata.duration || 0;
        } catch (parseError) {
          console.error('Error parsing metadata:', parseError);
        }
      }

      // Download the video file
      const downloadCmd = `yt-dlp -f "best[ext=mp4]/best" -o "${localFilePath}" "${url}"`;
      
      exec(downloadCmd, async (downloadError, downloadStdout, downloadStderr) => {
        if (downloadError) {
          console.error('Error downloading video:', downloadError);
          console.error('Stderr:', downloadStderr);
          return res.status(500).json({ error: 'Failed to download video', details: downloadStderr });
        }

        // Check if file was downloaded
        if (!fs.existsSync(localFilePath)) {
          return res.status(500).json({ error: 'Video file not found after download' });
        }

        // Get file size
        const stats = fs.statSync(localFilePath);
        fileSize = stats.size;

        // Read file and upload to R2
        try {
          const fileContent = fs.readFileSync(localFilePath);
          
          const uploadParams = {
            Bucket: R2_CONFIG.bucket,
            Key: r2Key,
            Body: fileContent,
            ContentType: 'video/mp4',
            Metadata: {
              'original-url': sanitizeMetadata(url),
              'description': sanitizeMetadata(description),
              'title': sanitizeMetadata(title),
            },
          };

          await s3Client.send(new PutObjectCommand(uploadParams));
          console.log(`✅ Uploaded to R2: ${r2Key}`);

          // Clean up local file
          fs.unlinkSync(localFilePath);

          // Generate presigned URL for public access
          let publicUrl;
          if (R2_CONFIG.publicUrl) {
            // If custom public URL is configured, use it directly
            publicUrl = `${R2_CONFIG.publicUrl}/${r2Key}`;
          } else {
            // Generate presigned URL (works with private buckets)
            const getObjectParams = {
              Bucket: R2_CONFIG.bucket,
              Key: r2Key,
            };
            publicUrl = await getSignedUrl(s3Client, new GetObjectCommand(getObjectParams), {
              expiresIn: R2_CONFIG.urlExpiration,
            });
          }

          res.json({
            url: publicUrl,
            r2Key: r2Key,
            bucket: R2_CONFIG.bucket,
            fileId: fileId,
            description: description,
            title: title,
            duration: duration,
            size: fileSize,
            sizeFormatted: formatFileSize(fileSize),
            uploadedAt: new Date().toISOString(),
            urlExpiresIn: R2_CONFIG.publicUrl ? null : R2_CONFIG.urlExpiration, // null if using custom domain
            urlExpiresAt: R2_CONFIG.publicUrl ? null : new Date(Date.now() + R2_CONFIG.urlExpiration * 1000).toISOString(),
          });
        } catch (uploadError) {
          console.error('Error uploading to R2:', uploadError);
          // Clean up local file even on upload error
          if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
          }
          return res.status(500).json({ 
            error: 'Failed to upload to Cloudflare R2', 
            details: uploadError.message 
          });
        }
      });
    });
  } catch (error) {
    console.error('Error in download endpoint:', error);
    // Clean up local file on error
    if (fs.existsSync(localFilePath)) {
      try {
        fs.unlinkSync(localFilePath);
      } catch (unlinkError) {
        console.error('Error cleaning up file:', unlinkError);
      }
    }
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get presigned URL endpoint (regenerate URL for existing file)
app.get('/url/:fileId', async (req, res) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(400).json({ error: 'File ID missing' });
  }

  const r2Key = `videos/${fileId}.mp4`;

  try {
    let publicUrl;
    if (R2_CONFIG.publicUrl) {
      // If custom public URL is configured, use it directly
      publicUrl = `${R2_CONFIG.publicUrl}/${r2Key}`;
    } else {
      // Generate presigned URL
      const getObjectParams = {
        Bucket: R2_CONFIG.bucket,
        Key: r2Key,
      };
      publicUrl = await getSignedUrl(s3Client, new GetObjectCommand(getObjectParams), {
        expiresIn: R2_CONFIG.urlExpiration,
      });
    }

    res.json({
      url: publicUrl,
      r2Key: r2Key,
      fileId: fileId,
      urlExpiresIn: R2_CONFIG.publicUrl ? null : R2_CONFIG.urlExpiration,
      urlExpiresAt: R2_CONFIG.publicUrl ? null : new Date(Date.now() + R2_CONFIG.urlExpiration * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    return res.status(500).json({ 
      error: 'Failed to generate presigned URL', 
      details: error.message 
    });
  }
});

// Delete endpoint
app.delete('/delete/:fileId', async (req, res) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(400).json({ error: 'File ID missing' });
  }

  const r2Key = `videos/${fileId}.mp4`;

  try {
    const deleteParams = {
      Bucket: R2_CONFIG.bucket,
      Key: r2Key,
    };

    await s3Client.send(new DeleteObjectCommand(deleteParams));
    console.log(`✅ Deleted from R2: ${r2Key}`);

    res.json({
      success: true,
      message: 'File deleted successfully',
      fileId: fileId,
      r2Key: r2Key,
      deletedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error deleting from R2:', error);
    return res.status(500).json({ 
      error: 'Failed to delete file from Cloudflare R2', 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ IG Downloader running on port ${PORT}`);
});
