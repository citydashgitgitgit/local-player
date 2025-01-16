import {useEffect, useRef, useState} from "react";
import axios from "axios";
import {isLocalPlaylistHasDifference, onVideoEnd} from "@/scripts/player";
import {get, set} from "@/localStorage";
import {MESSAGE_TYPES, writeLog} from "@/scripts/logger";

export default function Home() {
  const [playlistArray, setPlaylistArray] = useState<string[]>([]);
  const [adObject, setAdObject] = useState(null);
  const [currentVideoIndex, setCurrentVideoIndex] = useState<number>(0);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string>("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);  // To track error state
  const [isInternetOk, setIsInternetOk] = useState(false);
  const videoRef = useRef(null);

  const handleError = (e) => {
    localStorage.setItem("playlist", JSON.stringify([]));
  };

  useEffect(() => {
    setInterval(async () => {
      try {
        await fetch(process.env.NEXT_PUBLIC_SERVER_URL + "/health-check", { method: "GET", mode: 'no-cors' });
        setIsInternetOk(prev => true);
        console.log("Internet connection established");
      } catch(e) {
        setIsInternetOk(prev => false);
        console.log("Lost internet connection");
      }

    }, 5000);
  }, []);

  async function fetchDataFromServer()  {
    try {
      const response = await axios.get("/api/getDrumContent", { headers: { "Range": "bytes=0-500000" } });
      const { playlist, adObject } = response.data;
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
        console.log("playlist from server", playlistFromServer);
        if (isLocalPlaylistHasDifference(localPlaylist, playlistFromServer)) {
          set("playlist", playlistFromServer);
          set("adObject", adObjectFromServer);
          setPlaylistArray(playlistFromServer);
          console.log("SETTING URL:", `${playlistFromServer[0]}?t=${new Date().getTime()}`);
          setCurrentVideoSrc(`${playlistFromServer[0]}?t=${new Date().getTime()}`);
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
      console.log("initialize");
      try {
        if (typeof window !== "undefined") {
          let playlist = getPlaylistFromLocalStorage();
          let adObject = JSON.parse(get("adObject") || null);
          if (!playlist.length || !adObject) {
            const { playlist: playlistFromServer, adObject: adObjectFromServer } = await fetchDataFromServer();
            playlist = playlistFromServer;
            adObject = adObjectFromServer;
            console.log("Вытянули данные из сервера короче");
          }

          console.log("playlist", playlist);
          console.log("adObject", adObject);

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
  }, [isInternetOk]);

  useEffect(() => {
    if (videoRef.current) {
      const video = videoRef.current;
      video.addEventListener('error', handleError);

      return () => {
        video.removeEventListener('error', handleError);
      };
    }
  }, []);

  return (
    <div>
      {playlistArray.length > 0 && adObject ? (
        <div style={{ position: "relative", top: 0, left: 0 }}>
          <video
            ref={videoRef}
            src={`/api/videos?path=${currentVideoSrc.replace("/", "")}`}
            autoPlay
            muted
            onError={handleError}
            style={{
              position: "absolute",
              width: `${adObject?.specs?.screen?.width}px`,
              height: `${adObject?.specs?.screen?.height}px`,
              top: 0,
              left: 0,
              zIndex: 2,
            }}
            loop={playlistArray.length === 1}
            onEnded={() => {
              onVideoEnd(
                playlistArray,
                currentVideoIndex,
                setCurrentVideoIndex,
                setCurrentVideoSrc
              )
            }}
          />
          <video
            src={'/yellow_background.mov'}
            style={{
              width: `${1}px`,
              height: `${1}px`,
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 5,
            }}
            loop={true}
          />
        </div>
      ) : (
        <p>Loading playlist and board size from server...</p>
      )}
    </div>
  );
}
