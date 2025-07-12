import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipForward, SkipBack, Search, Heart, Shuffle, Repeat, Volume2, List, TrendingUp, Zap } from 'lucide-react';

const MusicPlayer = () => {
    const [currentSong, setCurrentSong] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playlist, setPlaylist] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [categoryPlaylists, setCategoryPlaylists] = useState([]);
    const [volume, setVolume] = useState(0.7);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('search');
    const [smartPlaylist, setSmartPlaylist] = useState([]);
    const [genres, setGenres] = useState([]);
    const [selectedGenre, setSelectedGenre] = useState('');

    const audioRef = useRef(null);

    useEffect(() => {
        loadCategoryPlaylists();
        loadGenres();
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const updateTime = () => setCurrentTime(audio.currentTime);
        const updateDuration = () => setDuration(audio.duration);
        const handleEnded = () => playNext();

        audio.addEventListener('timeupdate', updateTime);
        audio.addEventListener('loadedmetadata', updateDuration);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('timeupdate', updateTime);
            audio.removeEventListener('loadedmetadata', updateDuration);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [currentSong]);

    const searchSongs = async (query) => {
        if (!query.trim()) return;
        setIsLoading(true);
        try {
            const res = await fetch(`http://localhost:3000/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data?.success) {
                setSearchResults([{
                    id: data.data.metadata.spotify_id,
                    title: data.data.metadata.title,
                    artist: data.data.metadata.artist,
                    album: data.data.metadata.album,
                    duration: `${Math.floor(data.data.stream.duration / 60)}:${(data.data.stream.duration % 60).toString().padStart(2, '0')}`,
                    streamUrl: `http://localhost:3000/stream?id=${data.data.youtube.videoId}`
                }]);
            }
        } catch (err) {
            console.error('Search error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadCategoryPlaylists = async () => {
        setIsLoading(true);
        try {
            const popularCategories = ['pop', 'rock', 'hiphop', 'chill', 'party'];
            const playlists = [];
            for (const category of popularCategories) {
                try {
                    const res = await fetch(`http://localhost:3000/categories/${category}/playlists`);
                    const data = await res.json();
                    if (data.success && Array.isArray(data.data)) {
                        const categoryPlaylists = data.data.map((playlist, idx) => ({
                            id: playlist.id || idx,
                            title: playlist.name,
                            artist: `Various Artists (${category})`,
                            album: `Playlist: ${playlist.name}`,
                            duration: '3:30', // Fallback duration
                            streamUrl: `http://localhost:3000/stream?query=${encodeURIComponent(playlist.name)}`
                        }));
                        playlists.push(...categoryPlaylists.slice(0, 4)); // Limit to 4 per category
                    }
                } catch (err) {
                    console.error(`Failed to load ${category} playlists:`, err);
                }
            }
            // Remove duplicates by id and limit to 20
            const uniquePlaylists = Array.from(
                new Map(playlists.map(p => [p.id, p])).values()
            ).slice(0, 20);
            setCategoryPlaylists(uniquePlaylists);
        } catch (err) {
            console.error('Failed to load category playlists:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadGenres = async () => {
        try {
            const res = await fetch('http://localhost:3000/genres');
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                setGenres(data.data);
            }
        } catch (err) {
            console.error('Failed to load genres:', err);
        }
    };

    const loadRecommendationsByGenre = async (genre) => {
        if (!genre) return;
        setIsLoading(true);
        try {
            const res = await fetch(`http://localhost:3000/recommendations?genre=${encodeURIComponent(genre)}`);
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                setSmartPlaylist(data.data.map((song, idx) => ({
                    id: song.id || idx,
                    title: song.name,
                    artist: song.artist,
                    album: song.album,
                    duration: `${Math.floor(song.duration / 1000 / 60)}:${((song.duration / 1000) % 60).toString().padStart(2, '0')}`,
                    streamUrl: `http://localhost:3000/stream?query=${encodeURIComponent(song.name)}`
                })));
            }
        } catch (err) {
            console.error('Failed to load recommendations:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const playSong = (song, index = 0) => {
        setCurrentSong(song);
        setCurrentIndex(index);
        setIsPlaying(true);
        if (audioRef.current) {
            audioRef.current.src = song.streamUrl;
            audioRef.current.play();
        }
    };

    const togglePlayPause = () => {
        if (!currentSong) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    const playNext = () => {
        const nextIndex = (currentIndex + 1) % playlist.length;
        playSong(playlist[nextIndex], nextIndex);
    };

    const playPrevious = () => {
        const prevIndex = currentIndex === 0 ? playlist.length - 1 : currentIndex - 1;
        playSong(playlist[prevIndex], prevIndex);
    };

    const SongItem = ({ song, index }) => (
        <div className="flex items-center justify-between p-3 hover:bg-gray-800 rounded-lg">
            <div className="flex items-center space-x-3">
                <button
                    onClick={() => {
                        setPlaylist(searchResults.length > 0 ? searchResults : categoryPlaylists.length > 0 ? categoryPlaylists : smartPlaylist);
                        playSong(song, index);
                    }}
                    className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center"
                >
                    <Play size={14} className="text-white ml-0.5" />
                </button>
                <div>
                    <h3 className="text-white font-medium">{song.title}</h3>
                    <p className="text-gray-400 text-sm">{song.artist}</p>
                </div>
            </div>
            <span className="text-gray-400 text-sm">{song.duration}</span>
        </div>
    );

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="bg-gray-900 min-h-screen text-white">
            <audio ref={audioRef} volume={volume} />

            <header className="p-4 bg-gray-800">
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-bold">Music Player</h1>
                    <div className="flex items-center space-x-4">
                        <Search size={20} />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                searchSongs(e.target.value);
                            }}
                            placeholder="Search..."
                            className="bg-gray-700 rounded-full px-4 py-2 w-64 text-white"
                        />
                    </div>
                </div>
            </header>

            <main className="p-4">
                {isLoading ? (
                    <div className="text-center text-gray-400">Loading...</div>
                ) : (
                    <div>
                        {genres.length > 0 && (
                            <div className="mb-6">
                                <h2 className="text-xl font-semibold mb-2">Genres</h2>
                                <select
                                    value={selectedGenre}
                                    onChange={(e) => {
                                        setSelectedGenre(e.target.value);
                                        loadRecommendationsByGenre(e.target.value);
                                    }}
                                    className="bg-gray-700 text-white p-2 rounded"
                                >
                                    <option value="">Select a genre</option>
                                    {genres.map((genre, idx) => (
                                        <option key={idx} value={genre}>{genre}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {searchResults.length > 0 && (
                            <div className="mb-6">
                                <h2 className="text-xl font-semibold mb-2">Search Results</h2>
                                {searchResults.map((song, i) => <SongItem key={song.id} song={song} index={i} />)}
                            </div>
                        )}

                        {categoryPlaylists.length > 0 && (
                            <div className="mb-6">
                                <h2 className="text-xl font-semibold mb-2">Popular Playlists</h2>
                                {categoryPlaylists.map((song, i) => <SongItem key={song.id} song={song} index={i} />)}
                            </div>
                        )}

                        {smartPlaylist.length > 0 && (
                            <div>
                                <h2 className="text-xl font-semibold mb-2">Recommended for You</h2>
                                {smartPlaylist.map((song, i) => <SongItem key={song.id} song={song} index={i} />)}
                            </div>
                        )}
                    </div>
                )}
            </main>

            {currentSong && (
                <footer className="fixed bottom-0 left-0 right-0 bg-gray-800 p-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold">{currentSong.title}</h3>
                        <p className="text-sm text-gray-400">{currentSong.artist}</p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <SkipBack onClick={playPrevious} className="cursor-pointer" />
                        <button onClick={togglePlayPause} className="bg-green-500 w-10 h-10 rounded-full flex items-center justify-center">
                            {isPlaying ? <Pause /> : <Play />}
                        </button>
                        <SkipForward onClick={playNext} className="cursor-pointer" />
                    </div>
                    <div className="w-1/4 text-right">
                        <Volume2 className="inline-block mr-2" />
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={volume}
                            onChange={(e) => {
                                setVolume(parseFloat(e.target.value));
                                audioRef.current.volume = parseFloat(e.target.value);
                            }}
                        />
                    </div>
                </footer>
            )}
        </div>
    );
};

export default MusicPlayer;