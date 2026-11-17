import React, { useState, useEffect } from 'react';
import { Smartphone, RotateCw } from 'lucide-react';
import { unlockScreenOrientation, forceLandscapeOrientation, isDeviceLandscape } from '@/src/lib/orientationUtils';
import { toast } from 'sonner';

export default function OrientationButton() {
  const [isLandscape, setIsLandscape] = useState(isDeviceLandscape());
  const [hasOrientationApi, setHasOrientationApi] = useState(false);

  useEffect(() => {
    // Automatically unlock orientation on startup
    unlockScreenOrientation();

    if (typeof window !== 'undefined' && window.screen?.orientation) {
      setHasOrientationApi(true);
      const handleOrientationChange = () => {
        setIsLandscape(isDeviceLandscape());
      };

      try {
        window.screen.orientation.addEventListener('change', handleOrientationChange);
      } catch (e) {
        window.addEventListener('resize', handleOrientationChange);
      }

      return () => {
        try {
          window.screen.orientation.removeEventListener('change', handleOrientationChange);
        } catch (e) {
          window.removeEventListener('resize', handleOrientationChange);
        }
      };
    }
  }, []);

  const handleToggle = async () => {
    if (!isLandscape) {
      const locked = await forceLandscapeOrientation();
      if (locked) {
        setIsLandscape(true);
        toast.success('Landscape mode enabled');
      } else {
        unlockScreenOrientation();
        toast.info('Auto-rotation unlocked! Turn your tablet horizontally.');
      }
    } else {
      unlockScreenOrientation();
      toast.info('Auto-rotation active! Screen will adapt to tablet angle.');
    }
  };

  if (!hasOrientationApi) return null;

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-sm border bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 hover:text-white"
      title={isLandscape ? "Auto-rotate active (Landscape). Click to refresh rotation." : "Portrait detected. Click to switch to Landscape."}
    >
      <RotateCw size={13} className={!isLandscape ? "text-amber-400" : "text-blue-400"} />
      <span className="hidden sm:inline">
        {isLandscape ? 'Landscape' : 'Rotate Tab'}
      </span>
    </button>
  );
}
