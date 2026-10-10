import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../../shared/types';
import { verificationMeter } from '../../shared/setupVerification';

// Subscribe only while the verification page is mounted. No full app render per sample.
export function useVerificationMeter(snapshot: AppSnapshot, name: string) {
  const [sample, setSample] = useState({ name: '', timestamp: 0, level: null as number | null });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let frame = 0;
    let pending = sample;
    const dispose = window.obsGuard.onMeter(next => {
      const input = next.inputs?.find(item => item.inputName === name);
      if (!input) return;
      pending = { name, timestamp: input.timestamp, level: input.levelDb };
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        setSample(pending);
        setNow(Date.now());
      });
    });
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => { dispose(); cancelAnimationFrame(frame); clearInterval(timer); };
  }, [name]);
  const fallback = verificationMeter(snapshot, name, now);
  if (!snapshot.connected) return { timestamp: 0, level: null };
  if (sample.name !== name || sample.timestamp < fallback.timestamp) return fallback;
  return { timestamp: sample.timestamp, level: now - sample.timestamp < 2000 &&
    sample.level !== null && Number.isFinite(sample.level) ? sample.level : null };
}
