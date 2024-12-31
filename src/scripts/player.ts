import React from "react";

export function onVideoEnd(
	playlistArray: string[],
	currentIndex: number,
	setCurrentIndex: React.Dispatch<React.SetStateAction<number>>,
	setCurrentVideoSrc: React.Dispatch<React.SetStateAction<string>>
) {

	if (playlistArray?.length > 0) {
		const maxIndex = playlistArray.length - 1;
		if (currentIndex < maxIndex) {
			setCurrentIndex(prev => {
				const newIndex = prev + 1;
				setCurrentVideoSrc(`${playlistArray[newIndex]}?t=${new Date().getTime()}`);
				return newIndex;
			});
		} else {
			console.log("setting src to", `${playlistArray[0]}?t=${new Date().getTime()}`);
			setCurrentIndex(0);
			setCurrentVideoSrc(`${playlistArray[0]}?t=${new Date().getTime()}`);
		}
	} else {
		console.error("Playlist is empty, cannot proceed");
	}
}

export const isLocalPlaylistHasDifference = (
	localPlaylist: string[],
	playlistFromServer: string[]
) => {
	if (localPlaylist.length !== playlistFromServer.length) {
		console.log("detected difference in files length. Resolving...");
		return true;
	}

	for (let i = 0; i < localPlaylist.length; i++) {
		if (localPlaylist[i] !== playlistFromServer[i]) {
			console.log("detected difference in files. Resolving...");
			return true;
		}
	}

	return false;
}