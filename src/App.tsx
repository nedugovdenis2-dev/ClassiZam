import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { TrackList } from './components/TrackList';
import { Recorder } from './components/Recorder';
import { LessonMode } from './components/LessonMode';
import { Upload, Music, Activity, BookOpen } from 'lucide-react';

export default function App() {
  const { loadTracks, addTrack, state } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'database' | 'lesson'>('database');

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await addTrack(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0502] text-white font-sans selection:bg-indigo-500/30 flex flex-col">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-[radial-gradient(circle_at_50%_30%,#3a1510_0%,transparent_60%),radial-gradient(circle_at_10%_80%,#ff4e00_0%,transparent_50%)] opacity-40 blur-[100px]" />
      </div>

      <main className="relative z-10 container mx-auto px-4 py-12 flex flex-col items-center flex-grow">
        <header className="text-center mb-12">
          <div className="inline-flex items-center justify-center p-3 bg-white/5 rounded-2xl mb-6 border border-white/10 shadow-2xl backdrop-blur-md">
            <Activity className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-orange-400">
            ClassiZam
          </h1>
          <p className="text-indigo-300/80 text-sm font-medium tracking-widest uppercase mb-6">
            надёжное средство против Иринки
          </p>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Мгновенно распознавайте музыку. Добавьте свои треки в локальную базу данных и начните распознавание.
          </p>
        </header>

        <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <div className="flex flex-col items-center">
            <Recorder />
          </div>
          
          <div className="flex flex-col w-full">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={state === 'ANALYZING' || state === 'RECORDING'}
              className="w-full flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl p-4 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group mb-6"
            >
              <Upload className="w-6 h-6 text-indigo-300 group-hover:-translate-y-1 transition-transform" />
              <span className="font-semibold text-lg">Добавить трек в базу</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,audio/mp4,audio/x-m4a,audio/mpeg"
              className="hidden"
            />
            
            <div className="w-full max-w-md mx-auto flex bg-white/5 p-1 rounded-xl border border-white/10">
              <button
                onClick={() => setActiveTab('database')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'database' 
                    ? 'bg-indigo-500/20 text-indigo-300 shadow-sm' 
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Music className="w-4 h-4" />
                База треков
              </button>
              <button
                onClick={() => setActiveTab('lesson')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'lesson' 
                    ? 'bg-emerald-500/20 text-emerald-300 shadow-sm' 
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                Режим урока
              </button>
            </div>

            {activeTab === 'database' ? <TrackList /> : <LessonMode />}
          </div>
        </div>
      </main>

      <footer className="relative z-10 w-full py-6 text-center text-xs text-gray-500/60 mt-auto">
        <p>разработчик денчик слазит | TG: @onlydotahikka</p>
      </footer>
    </div>
  );
}
