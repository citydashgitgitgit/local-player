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
  const [nextVideoSrc, setNextVideoSrc] = useState<string>("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);  // To track error state
  const [isInternetOk, setIsInternetOk] = useState(false);
  const firstVideoRef = useRef(null);
  const secondVideoRef = useRef(null);

  const [currentVideoElementIndex, setCurrentVideoElementIndex] = useState<number>(0);

  useEffect(() => {
    if (currentVideoElementIndex === 0) {
      setCurrentVideoElementIndex(1);
      secondVideoRef.current?.play();
      firstVideoRef.current?.pause();
    } else {
      setCurrentVideoElementIndex(0);
      firstVideoRef.current?.play();
      secondVideoRef.current?.pause();
    }
  }, [currentVideoIndex]);

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
    if (firstVideoRef.current) {
      const video = firstVideoRef.current;
      video.addEventListener('error', handleError);

      return () => {
        video.removeEventListener('error', handleError);
      };
    }
  }, []);

  function onButtonPress() {
    if (firstVideoRef.current?.paused) {
      firstVideoRef.current.play();
    } else {
      firstVideoRef.current.pause();
    }
  }

  useEffect(() => {

  }, [currentVideoIndex]);

  return (
    <div>
      <button onClick={onButtonPress}>stop/play</button>
      {playlistArray.length > 0 && adObject ? (
        <>
          <h2>Current - {currentVideoSrc}</h2>
          <h2>Next - {nextVideoSrc}</h2>
          <video
            ref={firstVideoRef}
            src={`/api/videos?path=${currentVideoElementIndex === 0 ? currentVideoSrc : nextVideoSrc}`}
            autoPlay
            muted
            onError={handleError}
            style={{
              width: `${adObject?.specs?.screen?.width}px`,
              height: `${adObject?.specs?.screen?.height}px`,
              display: currentVideoElementIndex === 0 ? "block" : "none",
            }}
            loop={playlistArray.length === 1}
            onEnded={() => {
              onVideoEnd(
                playlistArray,
                currentVideoIndex,
                setCurrentVideoIndex,
                setCurrentVideoSrc,
                setNextVideoSrc
              )
            }}
          />
          <video
              ref={secondVideoRef}
              src={`/api/videos?path=${currentVideoElementIndex === 1 ? currentVideoSrc : nextVideoSrc}`}
              autoPlay
              muted
              onError={handleError}
              style={{
                width: `${adObject?.specs?.screen?.width}px`,
                height: `${adObject?.specs?.screen?.height}px`,
                border: "1px solid red",
                display: currentVideoElementIndex === 1 ? "block" : "none",
              }}
              loop={playlistArray.length === 1}
              onEnded={() => {
                onVideoEnd(
                    playlistArray,
                    currentVideoIndex,
                    setCurrentVideoIndex,
                    setCurrentVideoSrc,
                    setNextVideoSrc
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
