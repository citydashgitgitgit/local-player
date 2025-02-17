import express from 'express';
import { spawn } from 'child_process';
import axios from 'axios';
import cors from 'cors';
import fs from "fs";
import type {NextApiRequest, NextApiResponse} from "next";
import {removeUnnecessaryFiles} from "@/pages/api/getDrumContent";
import { promises as fsPromises } from 'fs';
// import MP4Box from 'mp4box';
const app = express();

app.use(cors());

const PLAYLIST_COMPARE_INTERVAL_IN_MINUTES = process.env.NEXT_PUBLIC_PLAYLIST_COMPARE_INTERVAL_IN_MINUTES || 4;
const REMOVE_UNUSED_VIDEOS_INTERVAL_IN_MINUTES = process.env.NEXT_PUBLIC_REMOVE_UNUSED_VIDEOS_INTERVAL_IN_MINUTES || 60;

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

async function isFileDownloaded(filePath: string) {
    try {
        // Get file stats asynchronously
        const stats = await fsPromises.stat(filePath);
        const fileSize = stats.size;

        // Read only the first chunk of the file to check headers
        const CHUNK_SIZE = 8192; // 8KB is usually enough for MP4 headers
        const fileHandle = await fsPromises.open(filePath, 'r');
        const { buffer } = await fileHandle.read({
            buffer: Buffer.alloc(CHUNK_SIZE),
            offset: 0,
            length: CHUNK_SIZE,
            position: 0
        });
        await fileHandle.close();

        // Quick validation of MP4 header
        if (buffer.length < 8) {
            return false;
        }

        // Check for common MP4 signatures
        const signature = buffer.toString('hex', 4, 8);
        const validSignatures = ['66747970', '6d6f6f76', '6d646174']; // ftypmoov, mdat
        if (!validSignatures.includes(signature)) {
            return false;
        }

        // For additional validation, you can check the last chunk if needed
        if (fileSize > CHUNK_SIZE) {
            const lastChunkSize = Math.min(CHUNK_SIZE, fileSize % CHUNK_SIZE || CHUNK_SIZE);
            const lastFileHandle = await fsPromises.open(filePath, 'r');
            const { buffer: lastBuffer } = await lastFileHandle.read({
                buffer: Buffer.alloc(lastChunkSize),
                offset: 0,
                length: lastChunkSize,
                position: fileSize - lastChunkSize
            });
            await lastFileHandle.close();

            // Check if the last chunk contains valid MP4 data
            if (lastBuffer.length !== lastChunkSize) {
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error(`Error checking file ${filePath}:`, error);
        return false;
    }
}

async function isPlaylistDownloaded(filesPaths: string[]) {
    console.log(`Beginning to check ${filesPaths.length} files`);

    // Process files in batches to avoid overwhelming the system
    const BATCH_SIZE = 5;
    const results: boolean[] = [];

    for (let i = 0; i < filesPaths.length; i += BATCH_SIZE) {
        const batch = filesPaths.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(file => isFileDownloaded(file)));
        results.push(...batchResults);

        // Early exit if we find a file that's not downloaded
        if (batchResults.some(result => !result)) {
            return false;
        }
    }

    return results.every(downloaded => downloaded);
}

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
            await axios.get(`${VLC_HOST}/requests/status.json`, {
                auth,
                params: { command: 'pl_delete', id: item.id },
            });
        }

        const intervalId = setInterval(async () => {
            const [statusResponse, playlistResponse] = await Promise.all([
                axios.get(`${VLC_HOST}/requests/status.json`, { auth }),
                axios.get(`${VLC_HOST}/requests/playlist.json`, { auth }),
            ]);

            const playingVideoId = statusResponse.data.currentplid;

            if (currentPlayingVideoId !== playingVideoId) {
                clearInterval(intervalId);
                await axios.get(`${VLC_HOST}/requests/status.json`, {
                    auth,
                    params: { command: 'pl_delete', id: currentPlayingVideoId },
                });
            }
        }, 5000);

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

        await axios.get(`${VLC_HOST}/requests/status.json`, {
            auth,
            params: {
                command: 'pl_play',
                no_interaction: 1,  // Disable interface (no controls)
            },
        });

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
        await disableOSD();

        console.log('VLC is now in full-screen mode.');

    } catch (error) {
        console.error('Error playing videos in loop:', error.message);
    }
};

const playlistsEqual = async () => {
    const localPlaylist = JSON.parse(fs.readFileSync("board_meta/playlist.json", "utf8") || "[]");
    console.log("playlist local", localPlaylist.length);
    const response = await axios.get("http://localhost:3000/api/getDrumContent", { headers: { "Range": "bytes=0-500000" } });
    const { playlist } = response.data;
    console.log("playlist from server", playlist.length);
    let isEqual = true;

    if (playlist.length !== localPlaylist.length) isEqual = false;

    for (let i = 0; i < playlist.length; i++) {
        if (playlist[i] !== localPlaylist[i]) {
            isEqual = false;
        }
    }

    console.log("is equal", isEqual);

    if (!isEqual) {
        console.log("Detected difference in playlists.");
        const isFullyDownloaded = await isPlaylistDownloaded(playlist)
        if (isFullyDownloaded) {
            console.log("New playlist is fully downloaded. Replacing playlists with new one...");
            fs.writeFileSync("board_meta/playlist.json", JSON.stringify(playlist));
            await replacePlaylist(playlist);
            console.log("playlist replaced with new one");
        } else {
            console.log("New playlist was not fully downloaded. Won't replace playlist. Will try again in 5 seconds.");
            setTimeout(async () => {
                await playlistsEqual();
            }, 5 * 1000);
        }
    } else {
        console.log("playlists are equal, wont change anything");
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
        const initialVideos = JSON.parse(fs.readFileSync("board_meta/playlist.json", "utf8"));
        await playVideosInLoop(initialVideos);
        // res.send("playlist started");
        setInterval(() => {
            console.log("interval for checking playlists equal");
            playlistsEqual();
        }, 1000 * 60 * PLAYLIST_COMPARE_INTERVAL_IN_MINUTES);

        setInterval(() => {
            removeUnnecessaryFiles();
        }, 60 * 1000 * REMOVE_UNUSED_VIDEOS_INTERVAL_IN_MINUTES); // 1 hour
    }
}