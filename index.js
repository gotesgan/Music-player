import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import ytdl from "@distube/ytdl-core";
import cors from "cors";
import rateLimit from "express-rate-limit";
import qs from "qs";
import dotenv from "dotenv";
dotenv.config();
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.set("trust proxy", true);

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let spotifyToken = null;
let tokenExpiry = null;

async function getSpotifyToken() {
  if (spotifyToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log("Using cached token:", spotifyToken);
    return spotifyToken;
  }

  try {
    const data = qs.stringify({ grant_type: "client_credentials" });
    console.log("Requesting new Spotify token...");
    const response = await axios.post(
      "https://accounts.spotify.com/api/token",
      data,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    console.log("Token received:", response.data.access_token);
    spotifyToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return spotifyToken;
  } catch (error) {
    console.error(
      "Error getting Spotify token:",
      error.response?.data || error.message
    );
    throw new Error("Failed to authenticate with Spotify");
  }
}

async function searchSpotify(query) {
  try {
    const token = await getSpotifyToken();
    const response = await axios.get("https://api.spotify.com/v1/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: { q: query, type: "track", limit: 1 },
    });

    const tracks = response.data.tracks.items;
    if (tracks.length === 0) return null;

    const track = tracks[0];
    return {
      title: track.name,
      artist: track.artists.map((artist) => artist.name).join(", "),
      album: track.album.name,
      duration: track.duration_ms,
      image: track.album.images[0]?.url,
      spotify_id: track.id,
      search_query: `${track.name} ${track.artists[0].name}`,
    };
  } catch (error) {
    console.error("Spotify search error:", error.message);
    return null;
  }
}

async function searchYouTube(query) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
      query
    )}`;
    const response = await axios.get(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(response.data);
    const scriptTags = $("script").toArray();
    let videoId = null;

    for (const script of scriptTags) {
      const content = $(script).html();
      const match = content?.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      if (match?.[1]) {
        videoId = match[1];
        break;
      }
    }

    if (!videoId) throw new Error("No video found");
    return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  } catch (error) {
    console.error("YouTube search error:", error.message);
    throw new Error("Failed to search YouTube");
  }
}

async function getStreamUrl(videoId) {
  try {
    const info = await ytdl.getInfo(
      `https://www.youtube.com/watch?v=${videoId}`
    );
    const audioFormats = ytdl.filterFormats(info.formats, "audioonly");
    if (!audioFormats.length) throw new Error("No audio formats available");

    const bestFormat = audioFormats.sort(
      (a, b) => b.audioBitrate - a.audioBitrate
    )[0];

    return {
      url: bestFormat.url,
      quality: bestFormat.audioBitrate,
      format: bestFormat.container,
      title: info.videoDetails.title,
      duration: info.videoDetails.lengthSeconds,
    };
  } catch (error) {
    console.error("Stream URL error:", error.message);
    throw new Error("Failed to get stream URL");
  }
}

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// 💊 Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// 🔍 Search
app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query)
    return res.status(400).json({ error: 'Query parameter "q" is required' });

  try {
    const spotifyResult = await searchSpotify(query);
    if (!spotifyResult)
      return res.status(404).json({ error: "Song not found on Spotify" });

    const youtubeResult = await searchYouTube(spotifyResult.search_query);
    const streamInfo = await getStreamUrl(youtubeResult.videoId);

    res.json({
      success: true,
      data: {
        metadata: spotifyResult,
        youtube: youtubeResult,
        stream: streamInfo,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Search failed", message: error.message });
  }
});

// 🎧 Direct stream
app.get("/stream", async (req, res) => {
  const { query, id } = req.query;
  if (!query && !id)
    return res
      .status(400)
      .json({ error: 'Either "query" or "id" parameter is required' });

  try {
    let videoId = id;
    if (query && !id) {
      const spotifyResult = await searchSpotify(query);
      if (!spotifyResult)
        return res.status(404).json({ error: "Song not found" });

      const youtubeResult = await searchYouTube(spotifyResult.search_query);
      videoId = youtubeResult.videoId;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    res.set({
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    });
    ytdl(videoUrl, { filter: "audioonly", quality: "highestaudio" })
      .on("error", (err) =>
        res
          .status(500)
          .json({ error: "Streaming failed", message: err.message })
      )
      .pipe(res);
  } catch (error) {
    res.status(500).json({ error: "Streaming failed", message: error.message });
  }
});

// 🧠 Get YouTube video info
app.get("/info", async (req, res) => {
  const id = req.query.id;
  if (!id)
    return res
      .status(400)
      .json({ error: 'Video ID parameter "id" is required' });

  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${id}`);
    res.json({
      success: true,
      data: {
        title: info.videoDetails.title,
        author: info.videoDetails.author.name,
        duration: info.videoDetails.lengthSeconds,
        views: info.videoDetails.viewCount,
        thumbnail: info.videoDetails.thumbnails[0]?.url,
        description: info.videoDetails.description,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to get video info", message: error.message });
  }
});

// ✅ Spotify Extra Endpoints

// 🎧 Categories
app.get("/categories", async (req, res) => {
  try {
    const token = await getSpotifyToken();
    const response = await axios.get(
      "https://api.spotify.com/v1/browse/categories",
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: 50, country: "US" },
      }
    );
    console.log("Spotify categories response:", response.data);
    const categories = response.data.categories.items.map((cat) => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icons[0]?.url,
    }));
    res.json({ success: true, data: categories });
  } catch (err) {
    console.error(
      "Spotify categories error:",
      err.response?.data || err.message
    );
    res.status(err.response?.status || 500).json({
      error: "Failed to get categories",
      message: err.response?.data?.error?.message || err.message,
    });
  }
});

// 📂 Category playlists
app.get("/categories/:id/playlists", async (req, res) => {
  const { language } = req.query;
  try {
    const token = await getSpotifyToken();
    let query = `https://api.spotify.com/v1/browse/categories/${req.params.id}/playlists`;
    const params = { limit: 20, country: "US" };

    // If language is provided, search for playlists with language-specific keywords
    if (language) {
      query = "https://api.spotify.com/v1/search";
      params.q = `${req.params.id} ${language}`;
      params.type = "playlist";
    }

    const response = await axios.get(query, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    console.log(
      `Spotify category ${req.params.id} playlists response:`,
      response.data
    );
    const playlists = (
      response.data.playlists?.items ||
      response.data.items ||
      []
    ).map((p) => ({
      id: p.id,
      name: p.name,
      image: p.images[0]?.url,
      url: p.external_urls.spotify,
    }));
    res.json({ success: true, data: playlists });
  } catch (err) {
    console.error(
      `Spotify category ${req.params.id} playlists error:`,
      err.response?.data || err.message
    );
    res.status(err.response?.status || 500).json({
      error: "Failed to get category playlists",
      message: err.response?.data?.error?.message || err.message,
    });
  }
});

// 🆕 New releases
app.get("/new-releases", async (req, res) => {
  try {
    const token = await getSpotifyToken();
    const response = await axios.get(
      "https://api.spotify.com/v1/browse/new-releases",
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: 20, country: "US" },
      }
    );
    console.log("Spotify new releases response:", response.data);
    const albums = response.data.albums.items.map((a) => ({
      id: a.id,
      name: a.name,
      artist: a.artists.map((x) => x.name).join(", "),
      image: a.images[0]?.url,
      url: a.external_urls.spotify,
    }));
    res.json({ success: true, data: albums });
  } catch (err) {
    console.error(
      "Spotify new releases error:",
      err.response?.data || err.message
    );
    res.status(err.response?.status || 500).json({
      error: "Failed to get new releases",
      message: err.response?.data?.error?.message || err.message,
    });
  }
});

// 🧬 Genres
app.get("/genres", async (req, res) => {
  try {
    const token = await getSpotifyToken();
    const response = await axios.get("https://api.spotify.com/v1/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: { q: "genre:pop", type: "track", limit: 1 },
    });
    console.log("Spotify genres response:", response.data);
    const staticGenres = [
      "pop",
      "rock",
      "hip-hop",
      "jazz",
      "classical",
      "electronic",
      "country",
      "rap",
      "blues",
      "indie",
      "metal",
      "folk",
      "r&b",
      "soul",
      "reggae",
    ];
    res.json({ success: true, data: staticGenres });
  } catch (err) {
    console.error("Spotify genres error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      error: "Failed to get genres",
      message: err.response?.data?.error?.message || err.message,
    });
  }
});

// 🎯 Recommendations by genre
app.get("/recommendations", async (req, res) => {
  const { genre = "pop", language } = req.query;
  try {
    const token = await getSpotifyToken();
    const query = language ? `genre:${genre} ${language}` : `genre:${genre}`;
    const response = await axios.get("https://api.spotify.com/v1/search", {
      headers: { Authorization: `Bearer ${token}` },
      params: { q: query, type: "track", limit: 20 },
    });
    console.log("Spotify recommendations response:", response.data);
    const tracks = response.data.tracks.items.map((track) => ({
      id: track.id,
      name: track.name,
      artist: track.artists.map((a) => a.name).join(", "),
      album: track.album.name,
      duration: track.duration_ms,
      image: track.album.images[0]?.url,
    }));
    if (!tracks.length) {
      return res
        .status(404)
        .json({ error: "No tracks found for this genre or language" });
    }
    res.json({ success: true, data: tracks });
  } catch (err) {
    console.error(
      "Spotify recommendations error:",
      err.response?.data || err.message
    );
    res.status(err.response?.status || 500).json({
      error: "Failed to get recommendations",
      message: err.response?.data?.error?.message || err.message,
    });
  }
});
// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });
// 🧯 Error and 404
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// 🚀 Start server

export default app;
