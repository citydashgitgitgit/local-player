import {useEffect, useState} from "react";
import axios from "axios";
import {isLocalPlaylistHasDifference, onVideoEnd} from "@/scripts/player";
import {get, set} from "@/localStorage";
import {MESSAGE_TYPES, writeLog} from "@/scripts/logger";

export default function Home() {
  const [playlistArray, setPlaylistArray] = useState<string[]>([]);
  const [adObject, setAdObject] = useState(null);
  const [currentVideoIndex, setCurrentVideoIndex] = useState<number>(0);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string>("");

  async function fetchDataFromServer()  {
    try {
      const response = await axios.get("/api/getDrumContent");
      const { playlist, adObject } = response.data;
      setAdObject(adObject);
      return { playlist, adObject };
    } catch (error) {
      throw new Error("Error while fetching data from server");
    }
  }

  const getPlaylistFromLocalStorage = () : string[] => {
    return JSON.parse(localStorage.getItem("playlist") || "[]");
  }

  const checkLocalPlaylist = () : void => {
    const intervalId = setInterval(async () => {
      try {
        const { playlist: playlistFromServer, adObject: adObjectFromServer } = await fetchDataFromServer();
        const localPlaylist = getPlaylistFromLocalStorage();
        if (isLocalPlaylistHasDifference(localPlaylist, playlistFromServer)) {
          set("playlist", playlistFromServer);
          set("adObject", adObjectFromServer);
          setPlaylistArray(playlistFromServer);
          setCurrentVideoSrc(playlistFromServer[0]);
          setCurrentVideoIndex(0);
        }
      } catch(e) {
        writeLog(MESSAGE_TYPES.ERROR, e.message);
      }
    }, 1000 * 5);
  }

  useEffect(() => {
    checkLocalPlaylist();
  }, []);

  //init playlist
  useEffect(() => {
    const init = async () : Promise<void> => {
      try {
        if (typeof window !== "undefined") {
          let playlist = getPlaylistFromLocalStorage();
          let adObject = JSON.parse(get("adObject") || null);
          if (!playlist.length || !adObject) {
            const { playlist: playlistFromServer, adObject: adObjectFromServer } = await fetchDataFromServer();
            playlist = playlistFromServer;
            adObject = adObjectFromServer;
          }

          setPlaylistArray(playlist || []);
          setCurrentVideoSrc(playlist[0]);
          setCurrentVideoIndex(0);
          setAdObject(adObject);
        }
      } catch(e) {
        writeLog(MESSAGE_TYPES.ERROR, e.message);
      }
    }

    init();
  }, []);

  return (
    <div>
      {playlistArray.length > 0 && adObject ? (
        <>
          <span style={{color: "white", fontSize: 30, fontWeight: "bold"}}>
            Current video index: {currentVideoIndex}/{playlistArray.length - 1}
          </span>

          <video
            src={currentVideoSrc}
            autoPlay
            muted
            style={{
              width: `${adObject?.specs.screen.width}px`,
              height: `${adObject?.specs.screen.height}px`,
            }}
            // loop={true}
            onEnded={() => {
              onVideoEnd(
                playlistArray,
                currentVideoIndex,
                setCurrentVideoIndex,
                setCurrentVideoSrc
              )
            }}
          />
        </>
      ) : (
        <p>Loading playlist and board size from server...</p>
      )}
    </div>
  );
}
