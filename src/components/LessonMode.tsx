import { useStore } from '../store';
import { CheckCircle2, Circle, RotateCcw, BookOpen } from 'lucide-react';

export function LessonMode() {
  const tracks = useStore(store => store.tracks);
  const guessedTrackIds = useStore(store => store.guessedTrackIds);
  const resetLesson = useStore(store => store.resetLesson);

  const guessedCount = guessedTrackIds.length;
  const totalCount = tracks.length;
  const progress = totalCount === 0 ? 0 : Math.round((guessedCount / totalCount) * 100);

  return (
    <div className="w-full max-w-md mx-auto mt-8 bg-white/5 backdrop-blur-md rounded-2xl p-6 border border-white/10">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-emerald-400" />
          Режим урока
        </h2>
        {guessedCount > 0 && (
          <button
            onClick={resetLesson}
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10 flex items-center gap-2 text-sm"
            title="Сбросить прогресс"
          >
            <RotateCcw className="w-4 h-4" />
            Сброс
          </button>
        )}
      </div>
      
      {tracks.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Добавьте треки в базу, чтобы начать урок.</p>
      ) : (
        <>
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-400">Прогресс</span>
              <span className="text-emerald-400 font-mono">{guessedCount} / {totalCount}</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <ul className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {tracks.map(track => {
              const isGuessed = guessedTrackIds.includes(track.id);
              return (
                <li 
                  key={track.id} 
                  className={`rounded-xl p-3 flex justify-between items-center transition-colors ${
                    isGuessed ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    {isGuessed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-600 shrink-0" />
                    )}
                    <span className={`truncate pr-4 ${isGuessed ? 'text-emerald-100' : 'text-gray-300'}`}>
                      {track.name}
                    </span>
                  </div>
                  <span className={`text-xs font-mono shrink-0 ${isGuessed ? 'text-emerald-500/70' : 'text-gray-500'}`}>
                    {Math.floor(track.duration / 60)}:{(Math.floor(track.duration % 60)).toString().padStart(2, '0')}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
