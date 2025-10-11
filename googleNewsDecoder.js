// googleNewsDecoder.js
// Node.js (ESM/CommonJS compatible) utility to decode Google News "read/articles/CBM..." short URLs.
// - Node 18+ has global fetch; for older Node, install node-fetch and pass it in options.fetch
// - Usage example at bottom.

const defaultHeaders = {
  "User-Agent": "node-google-news-decoder/1.0 (+https://example.org)",
  "Referer": "https://news.google.com/",
  "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
};

class GoogleNewsDecoder {
  /**
   * options:
   *   fetch: (optional) custom fetch implementation (e.g. node-fetch)
   *   timeout: fetch timeout in ms (number) - used with AbortController
   *   cache: boolean (default true)
   *   cacheTTL: ms to keep cache entries (default 5 min)
   */
  constructor(options = {}) {
    this.fetch = options.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
    if (!this.fetch) {
      throw new Error("No fetch available. Pass a fetch implementation in options.fetch (e.g. node-fetch) or use Node 18+.");
    }
    this.timeout = options.timeout || 8000;
    this.headers = { ...defaultHeaders, ...(options.headers || {}) };
    this.cache = options.cache !== false;
    this.cacheTTL = options.cacheTTL || 5 * 60 * 1000;
    this._mem = new Map(); // simple in-memory cache: key -> { ts, value }
  }

  _cacheGet(key) {
    if (!this.cache) return null;
    const rec = this._mem.get(key);
    if (!rec) return null;
    if (Date.now() - rec.ts > this.cacheTTL) {
      this._mem.delete(key);
      return null;
    }
    return rec.value;
  }
  _cacheSet(key, value) {
    if (!this.cache) return;
    this._mem.set(key, { ts: Date.now(), value });
  }

  _urlsafeB64DecodeAuto(s) {
    // accept string, replace URL-safe chars, pad with '='
    if (typeof s !== "string") throw new TypeError("base64 input must be string");
    const t = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (t.length % 4)) % 4;
    const padded = t + "=".repeat(pad);
    // Buffer handles base64
    return Buffer.from(padded, "base64");
  }

  _parseVarint(buf, offset = 0) {
    // protobuf-style varint: returns { value, nextOffset }
    let result = 0n;
    let shift = 0n;
    let i = offset;
    while (true) {
      if (i >= buf.length) throw new Error("Unexpected end parsing varint");
      const b = BigInt(buf[i]);
      result |= (b & 0x7fn) << shift;
      i++;
      if ((b & 0x80n) === 0n) break;
      shift += 7n;
      if (shift > 63n) throw new Error("Varint too large");
    }
    return { value: Number(result), nextOffset: i };
  }

  async fetchDecodedBatchExecute(idStr) {
    // Check cache
    const ckey = `batchex:${idStr}`;
    const cached = this._cacheGet(ckey);
    if (cached) return cached;

    const fReqPayload =
      '[["Fbv4je","[\\"garturlreq\\",[[\\"en-US\\",\\"US\\",[\\"FINANCE_TOP_INDICES\\",\\"WEB_TEST_1_0_0\\"],' +
      'null,null,1,1,\\"US:en\\",null,180,null,null,null,null,null,0,null,null,[1608992183,723341000]],' +
      '\\"en-US\\",\\"US\\",1,[2,3,4,8],1,0,\\"655000234\\",0,0,null,0],\\"' +
      idStr +
      '\\"]",null,"generic"]]';

    const body = new URLSearchParams({ "f.req": fReqPayload }).toString();
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);

    let respText;
    try {
      const resp = await this.fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
        method: "POST",
        headers: this.headers,
        body,
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Bad status: ${resp.status}`);
      respText = await resp.text();
    } catch (err) {
      throw new Error("fetchDecodedBatchExecute failed: " + (err && err.message ? err.message : String(err)));
    } finally {
      clearTimeout(id);
    }

    // Find the garturlres marker and extract the escaped string
    const marker = '["garturlres","';
    const idx = respText.indexOf(marker);
    if (idx < 0) throw new Error("garturlres not found in batchexecute response");

    const start = idx + marker.length;
    const end = respText.indexOf('",', start);
    if (end < 0) throw new Error("end of garturlres string not found in response");

    const rawEscaped = respText.slice(start, end);

    // rawEscaped is the inner JSON string content, e.g. may contain \/ or \\uXXXX etc.
    // Safest: wrap in quotes and JSON.parse to unescape.
    let unescaped;
    try {
      unescaped = JSON.parse(`"${rawEscaped}"`);
    } catch (e) {
      // Fallback: replace common escapes
      try {
        unescaped = rawEscaped.replace(/\\\//g, "/").replace(/\\"/g, '"');
      } catch (e2) {
        unescaped = rawEscaped;
      }
    }

    this._cacheSet(ckey, unescaped);
    return unescaped;
  }

  /**
   * decode a Google News URL (string). If it's not a news.google.com read/articles URL,
   * returns the original sourceUrl.
   * If intermediary token requires server decoding, this method will call Google batchexecute.
   */
  async decode(sourceUrl) {
    if (typeof sourceUrl !== "string") throw new TypeError("sourceUrl must be string");
    let parsed;
    try {
      parsed = new URL(sourceUrl);
    } catch (e) {
      throw new Error("Invalid URL");
    }

    if (!parsed.hostname || !parsed.hostname.endsWith("news.google.com")) return sourceUrl;

    const rawSegments = parsed.pathname.split("/").filter(Boolean);
    if (rawSegments.length === 0) return sourceUrl;

    const last = rawSegments[rawSegments.length - 1];

    // Try decode last as urlsafe base64
    let decodedBytes;
    try {
      decodedBytes = this._urlsafeB64DecodeAuto(last);
    } catch (e) {
      return sourceUrl; // not a base64-like last segment
    }

    // Map bytes to latin1-like string (Buffer -> latin1)
    const decodedLatin1 = decodedBytes.toString("latin1");

    // prefix and suffix handling (based on observed patterns)
    const prefix = Buffer.from([0x08, 0x13, 0x22]).toString("latin1");
    const suffix = Buffer.from([0xD2, 0x01, 0x00]).toString("latin1");

    let working = decodedLatin1;
    if (working.startsWith(prefix)) working = working.slice(prefix.length);
    if (working.endsWith(suffix)) working = working.slice(0, working.length - suffix.length);

    // convert to bytes for varint parsing
    const b = Buffer.from(working, "latin1");

    // parse varint at beginning for payload length
    let payload;
    try {
      const { value: lengthVal, nextOffset } = this._parseVarint(b, 0);
      if (nextOffset + lengthVal > b.length) {
        // fallback: return as-is
        payload = b.slice(nextOffset).toString("latin1");
      } else {
        payload = b.slice(nextOffset, nextOffset + lengthVal).toString("latin1");
      }
    } catch (e) {
      // fallback: older code used first byte as length (not reliable). Try that as fallback.
      const len = b.length > 0 ? b[0] : 0;
      if (len > 0 && 1 + len <= b.length) {
        payload = b.slice(1, 1 + len).toString("latin1");
      } else {
        payload = working; // give up, return working
      }
    }

    // If payload looks like an intermediary token (AU_ / SAU_ / contains '_' and long),
    // call server to decode final url.
    const looksLikeToken = typeof payload === "string" && (payload.startsWith("AU_") || payload.startsWith("SAU_") || (payload.includes("_") && payload.length > 10));
    if (looksLikeToken) {
      try {
        return await this.fetchDecodedBatchExecute(last);
      } catch (e) {
        // If server decode fails, return payload for debugging
        return payload;
      }
    }

    // else return payload (may already be final URL or something readable)
    return payload;
  }
}

// 使用 export default 导出
export default GoogleNewsDecoder;

/* ---------- Usage example ----------
(async () => {
  // If using Node < 18, install node-fetch: npm i node-fetch
  // import fetch from 'node-fetch';
  // const decoder = new GoogleNewsDecoder({ fetch });

  // For ESM usage:
  import GoogleNewsDecoder from './googleNewsDecoder.js';
  const decoder = new GoogleNewsDecoder();

  const sample = "https://news.google.com/read/CBMiU0FVX3lxTE95dTFfQkJ5dmxyaEZCaUNDODlIbkF6R3BqSGVGdVk5OFVqSlYyNnVXY2RDN25VdlNBT3NSX1A0RmtLR1RxMTlBR2x3STVFNnlVOU00?hl=en-US&gl=US&ceid=US:en";
  try {
    const result = await decoder.decode(sample);
    console.log("Decoded:", result);
  } catch (err) {
    console.error("Error:", err);
  }
})();
------------------------------------- */