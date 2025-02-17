import express from 'express';
import { spawn } from 'child_process';
import axios from 'axios';
import cors from 'cors';
import fs from "fs";
import type {NextApiRequest, NextApiResponse} from "next";
import {removeUnnecessaryFiles} from "@/pages/api/getDrumContent";
const MP4Box = require('mp4box');
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
    return new Promise((resolve, reject) => {
        // Read the video file
        const fileData = fs.readFileSync(filePath); // Returns a Node.js Buffer
        const arrayBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength); // Convert to ArrayBuffer

        const mp4boxfile = MP4Box.createFile();
        mp4boxfile.onReady = (info) => {
            console.log("-------------checking file-------------");
            const fileSize = fs.statSync(filePath).size;
            console.log("Total file size: " + fileSize);

            // Calculate the total loaded size based on buffer length
            const loadedSize = arrayBuffer.byteLength; // Size of the loaded ArrayBuffer
            console.log(`Loaded data size: ${loadedSize} bytes`);

            if (fileSize > loadedSize) {
                console.log("File not fully downloaded");
                reject(false);
            } else {
                console.log("File fully downloaded");
                resolve(true);
            }
            console.log("---------------------------------------");
        };

        mp4boxfile.onError = (err) => {
            console.error(`--------------error checking file ${filePath}---------------`);
            console.error(err);
        }

        // Feed the ArrayBuffer to mp4box
        const buffer = arrayBuffer; // Use ArrayBuffer directly
        buffer.fileStart = 0; // Set the start position
        mp4boxfile.appendBuffer(buffer);
        mp4boxfile.flush(); // Finalize parsing
    })
}

async function isPlaylistDownloaded(filesPaths: string[]) {
    console.log(`Beginning to check ${filesPaths.length} files`);
    const downloads = await Promise.all(filesPaths.map(file => isFileDownloaded(file)));
    return downloads.every(downloaded => downloaded);
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