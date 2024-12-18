import {useEffect, useState} from "react";
import axios from "axios";
import {isLocalPlaylistHasDifference, onVideoEnd} from "@/scripts/player";
import {set} from "@/localStorage";

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
      console.error("Error fetching drum content:", error);
    }
  }

  const getPlaylistFromLocalStorage = () : string[] => {
    return JSON.parse(localStorage.getItem("playlist") || "[]");
  }

  const checkLocalPlaylist = () : void => {
    const intervalId = setInterval(async () => {
      console.log("checking local playlist difference...");
      try {
        const { playlist: playlistFromServer } = await fetchDataFromServer();
        const localPlaylist = getPlaylistFromLocalStorage();
        if (isLocalPlaylistHasDifference(localPlaylist, playlistFromServer)) {
          set("playlist", playlistFromServer);
          setPlaylistArray(playlistFromServer);
          setCurrentVideoSrc(playlistFromServer[0]);
        }
      } catch(e) {

      }
    }, 1000 * 5);
  }

  useEffect(() => {
    checkLocalPlaylist();
  }, []);

  //init playlist
  useEffect(() => {
    const init = async () : Promise<void> => {
      if (typeof window !== "undefined") {
        let playlist = getPlaylistFromLocalStorage();
        if (!playlist.length) {
          const { playlist: playlistFromServer, adObject } = await fetchDataFromServer();
          playlist = playlistFromServer;
        }

        setPlaylistArray(playlist || []);
        setCurrentVideoSrc(playlist[0]);
        setCurrentVideoIndex(0);
        setAdObject(adObject);
      }
    }

    init();
  }, []);

  return (
    <div>
      {playlistArray.length > 0 ? (
        <video
          src={currentVideoSrc}
          autoPlay
          muted
          style={{
            width: `${adObject?.specs.screen.width || 640}px`,
            height: `${adObject?.specs.screen.height || 360}px`,
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
      ) : (
        <p>Loading playlist...</p>
      )}
    </div>
  );
}
