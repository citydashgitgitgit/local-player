import express from 'express';
import { spawn } from 'child_process';
import axios from 'axios';
import cors from 'cors';
import fs from "fs";
import type {NextApiRequest, NextApiResponse} from "next";
const app = express();


app.use(cors());

// VLC configuration
const VLC_HOST = 'http://127.0.0.1:8080';
const VLC_PASSWORD = 'admin';
const auth = { username: '', password: VLC_PASSWORD };

const disableOSD = async () => {
    try {
        // Send command to disable OSD
        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: {
                command: 'osd',
                osd: 0,
            },
        });

        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: {
                command: 'osdtitle',
                value: 'off'
            },
        });

        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: {
                command: 'subtitles',
                value: 'off'
            },
        });

        console.log('OSD disabled. File path will not be displayed.');
    } catch (error) {
        console.error('Error disabling OSD:', error.message);
    }
};

// Function to enable looping
const enableLooping = async () => {
    try {
        // Enable loop mode
        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: { command: 'pl_loop' },
        });

        console.log('Looping enabled.');
    } catch (error) {
        console.error('Error enabling looping:', error.message);
    }
};

// Function to replace the playlist without interrupting current playback
const replacePlaylist = async (newFilePaths: string[]) => {
    try {
        console.log("Updating playlist without interrupting playback...");

        // Fetch the current playlist and playback status
        const [statusResponse, playlistResponse] = await Promise.all([
            axios.get(`${VLC_HOST}/requests/status.json`, { auth }),
            axios.get(`${VLC_HOST}/requests/playlist.json`, { auth }),
        ]);

        const currentPlayingVideoId = statusResponse.data.currentplid;
        const oldPlaylist = playlistResponse.data.children[0].children;
        const currentlyPlayingVideoIndex = oldPlaylist.findIndex(video => video.id == currentPlayingVideoId);

        oldPlaylist.splice(currentlyPlayingVideoIndex, 1);

        for (const item of oldPlaylist) {
            if (item.id !== currentPlayingVideoId) {
                console.log("wont delete currently playing video", item.id);
                await axios.get(`${VLC_HOST}/requests/status.json`, {
                    auth,
                    params: { command: 'pl_delete', id: item.id },
                });
            }
        }

        for (const filePath of newFilePaths) {
            await axios.get(`${VLC_HOST}/requests/status.json`, {
                auth,
                params: {
                    command: 'in_enqueue',
                    input: `file:///${encodeURIComponent(filePath)}`,
                },
            });
            console.log(`Added to playlist: ${filePath}`);
        }

    } catch (error) {
        console.error("Error updating playlist dynamically:", error.message);
    }
};

// Function to start playing videos in a loop
const playVideosInLoop = async (filePaths: string[]) => {
    try {
        // Clear the current playlist
        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: { command: 'pl_empty' },
        });

        console.log('Cleared existing playlist.');

        // Add all files to the playlist
        for (const filePath of filePaths) {
            await axios.get(`${VLC_HOST}/requests/status.json`, {
                auth,
                params: {
                    command: 'in_enqueue',
                    input: "file:///" + encodeURIComponent(filePath),
                },
            });
            console.log(`Added to playlist: ${filePath}`);
        }

        // Start playback (with no-interaction to hide interface)
        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: {
                command: 'pl_play',
                no_interaction: 1,  // Disable interface (no controls)
            },
        });

        console.log('Playlist is playing.');

        // Ensure VLC has started playing before sending the full-screen command
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 2 seconds

        // Set VLC to fullscreen after video starts playing
        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: { command: 'fullscreen', fullscreen: 1 },
        });

        // Enable looping
        await enableLooping();
        await disableOSD();

        console.log('VLC is now in full-screen mode.');

    } catch (error) {
        console.error('Error playing videos in loop:', error.message);
    }
};

const playlistsEqual = async () => {
    const localPlaylist = JSON.parse(fs.readFileSync("playlist.json", "utf8") || "[]");
    console.log("playlist local", localPlaylist);
    const response = await axios.get("http://localhost:3000/api/getDrumContent", { headers: { "Range": "bytes=0-500000" } });
    const { playlist } = response.data;
    console.log("playlist from server", playlist);
    let isEqual = true;

    if (playlist.length !== localPlaylist.length) isEqual = false;

    for (let i = 0; i < playlist.length; i++) {
        if (playlist[i] !== localPlaylist[i]) {
            isEqual = false;
        }
    }

    console.log("is equal", isEqual);

    if (!isEqual) {
        await replacePlaylist(playlist);
        console.log("playlist replaced with new one");
    } else {
        console.log("playlists are equal, wont change anything");
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
        const initialVideos = JSON.parse(fs.readFileSync("playlist.json", "utf8"));
        await playVideosInLoop(initialVideos);
        res.send("playlist started");
        setInterval(() => {
            playlistsEqual();
        }, 1000 * 30);
    }
}