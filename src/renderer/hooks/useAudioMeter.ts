import { useEffect, useRef, useState } from 'react';
import type { AppSnapshot, AudioMeterFrame } from '../../shared/types';

export const useAudioMeter = (snapshot: AppSnapshot | null): AudioMeterFrame => {
  const [frame, setFrame] = useState<AudioMeterFrame>(() => snapshotFrame(snapshot));
  const pendingRef = useRef<AudioMeterFrame | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    setFrame((current) => (
      current.timestamp === 0 ||
      current.activeInputName !== snapshot.activeInputName ||
      snapshot.lastLevelDb === null
        ? snapshotFrame(snapshot)
        : current
    ));
  }, [snapshot]);

  useEffect(() => {
    const dispose = window.obsGuard.onMeter((next) => {
      pendingRef.current = next;
      if (animationFrameRef.current !== null) return;
      animationFrameRef.current = requestAnimationFrame(() => {
        animationFrameRef.current = null;
        if (pendingRef.current) {
          setFrame(pendingRef.current);
          pendingRef.current = null;
        }
      });
    });

    return () => {
      dispose();
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  return frame;
};

const snapshotFrame = (snapshot: AppSnapshot | null): AudioMeterFrame => ({
  timestamp: snapshot ? Date.now() : 0,
  activeInputName: snapshot?.activeInputName ?? '',
  levelDb: snapshot?.lastLevelDb ?? null
});
