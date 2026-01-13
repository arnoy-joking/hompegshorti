const https = require('https');

// --- HELPER 1: Make HTTP Request ---
const fetchHtml = (url, cookieHeader) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    };

    // Attach cookies if provided
    if (cookieHeader) {
      options.headers['Cookie'] = cookieHeader;
    }

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
};

// --- HELPER 2: Parse Netscape cookies.txt content ---
const parseNetscapeCookies = (text) => {
  if (!text) return '';
  return text.split('\n')
    .filter(line => line && !line.startsWith('#') && line.trim() !== '')
    .map(line => {
      const parts = line.split('\t');
      // Netscape format: domain, flag, path, secure, expiration, name, value
      // We usually find name at index 5 and value at index 6
      if (parts.length >= 7) {
        return `${parts[5]}=${parts[6].trim()}`;
      }
      return null;
    })
    .filter(Boolean)
    .join('; ');
};

// --- HELPER 3: Recursive Finder for Shorts Data ---
const findShortsData = (obj, results = []) => {
  if (!obj || typeof obj !== 'object') return results;

  // We look for the key "shortsLockupViewModel"
  if (obj.shortsLockupViewModel) {
    const data = obj.shortsLockupViewModel;

    try {
      // 1. Title (Primary Text)
      let title = "Unknown";
      if (data.overlayMetadata?.primaryText?.content) {
        title = data.overlayMetadata.primaryText.content;
      } else if (data.accessibilityText) {
        // Fallback to accessibility text, stripping the ", X views" part
        title = data.accessibilityText.split(',')[0];
      }

      // 2. View Count (Secondary Text - e.g., "14M views")
      let viewCount = "N/A";
      if (data.overlayMetadata?.secondaryText?.content) {
        viewCount = data.overlayMetadata.secondaryText.content;
      }

      // 3. URL
      let url = null;
      const urlPath = data.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url;
      if (urlPath) {
        url = `https://www.youtube.com${urlPath}`;
      }

      // 4. Thumbnail
      let thumbnail = null;
      const sources = data.thumbnailViewModel?.thumbnailViewModel?.image?.sources;
      if (sources && sources.length > 0) {
        thumbnail = sources[sources.length - 1].url; // Grab the last one (usually highest res)
      }

      // 5. Entity ID
      const id = data.entityId;

      if (url) {
        results.push({
          id,
          title,
          views: viewCount,
          url,
          thumbnail
        });
      }
    } catch (err) {
      // If a specific item is malformed, skip it
    }
  }

  // Recursively check deeper into the object
  Object.keys(obj).forEach(key => {
    findShortsData(obj[key], results);
  });

  return results;
};

// --- MAIN HANDLER ---
exports.handler = async (event, context) => {
  // Allow simple GET for testing, POST for sending Cookies
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    let cookieHeader = '';

    // If cookies are sent in the body (as JSON)
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (body.cookiesContent) {
          cookieHeader = parseNetscapeCookies(body.cookiesContent);
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    // 1. Fetch Source
    const html = await fetchHtml('https://www.youtube.com/', cookieHeader);

    // 2. Extract JSON blob
    // YouTube stores initial data in: var ytInitialData = {...};
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});/);

    if (!match) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Failed to locate ytInitialData. YouTube might have changed layout or blocked the request." })
      };
    }

    // 3. Parse JSON
    const json = JSON.parse(match[1]);

    // 4. Find Shorts
    const shorts = findShortsData(json);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        total: shorts.length,
        data: shorts
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
