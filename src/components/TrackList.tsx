import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store';
import { Trash2, Music, Play, Square } from 'lucide-react';

export function TrackList() {
  const { tracks, clearTracks, removeTrack } = useStore();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        if (audioRef.current.src) URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);

  const showError = (msg: string) => {
    setLocalError(msg);
    setTimeout(() => setLocalError(null), 4000);
  };

  const handlePlay = (track: any) => {
    if (playingId === track.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      if (audioRef.current.src) URL.revokeObjectURL(audioRef.current.src);
    }

    if (track.audioBlob) {
      try {
        const url = URL.createObjectURL(track.audioBlob);
        const audio = new Audio(url);
        audio.onended = () => setPlayingId(null);
        audio.play().catch(e => {
          console.error(e);
          showError('Не удалось воспроизвести аудио.');
          setPlayingId(null);
        });
        audioRef.current = audio;
        setPlayingId(track.id);
      } catch (e) {
        showError('Ошибка загрузки аудио.');
      }
    } else {
      showError('Аудиофайл не сохранен (трек добавлен до обновления). Удалите его и добавьте заново.');
    }
  };

  const handleDelete = (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation();
    if (playingId === trackId) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    removeTrack(trackId);
  };

  const handleClearAll = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
    clearTracks();
  };

  return (
    <div className="w-full max-w-md mx-auto mt-8 bg-white/5 backdrop-blur-md rounded-2xl p-6 border border-white/10">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Music className="w-5 h-5 text-indigo-400" />
          База треков ({tracks.length})
        </h2>
        {tracks.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-red-400 hover:text-red-300 transition-colors p-2 rounded-full hover:bg-red-400/10"
            title="Очистить все треки"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {localError && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 text-sm text-center">
          {localError}
        </div>
      )}
      
      {tracks.length === 0 ? (
        <p className="text-gray-400 text-center py-8">В базе нет треков. Добавьте их, чтобы начать распознавание.</p>
      ) : (
        <ul className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
          {tracks.map(track => (
            <li key={track.id} className="bg-white/5 rounded-xl p-3 flex justify-between items-center group">
              <div className="flex items-center gap-3 overflow-hidden flex-1">
                <button 
                  onClick={() => handlePlay(track)}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
                  title={playingId === track.id ? "Стоп" : "Слушать"}
                >
                  {playingId === track.id ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                </button>
                <span className="text-gray-200 truncate pr-2">{track.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-gray-500 font-mono">
                  {Math.floor(track.duration / 60)}:{(Math.floor(track.duration % 60)).toString().padStart(2, '0')}
                </span>
                <button
                  onClick={(e) => handleDelete(e, track.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors p-1"
                  title="Удалить трек"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
