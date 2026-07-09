import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig, AppSnapshot } from '../../shared/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveApi {
  saveState: SaveState;
  /**
   * 推送一个待保存的 patch;内部 420ms 节流后真正写盘。
   * 多次连续调用会在 420ms 窗口内合并,只触发一次写盘。
   */
  scheduleSave: (patch: Partial<AppConfig>) => void;
  /**
   * 立即把当前 draft 整个写一次(忽略节流)。
   * 实际上直接调用 saveConfig 并返回 Promise。
   */
  flushSave: (patch: Partial<AppConfig>) => Promise<AppSnapshot>;
}

const SAVE_DEBOUNCE_MS = 420;

/**
 * 420ms 节流自动保存 hook(从原 SettingsApp 抽取)。
 *
 * 实现要点:
 * - 用 ref 持久化 timer 和 pending patch,避免闭包捕获旧值
 * - 组件卸载时(StrictMode 第二次挂载前)清理 timer,防止幽灵写盘
 * - flushSave 同步穿透到主进程,不依赖节流状态
 */
export const useAutoSave = (onSaved?: (snapshot: AppSnapshot) => void): AutoSaveApi => {
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pendingPatchRef = useRef<Partial<AppConfig>>({});
  const saveTimerRef = useRef<number | null>(null);
  // 防止异步回调在卸载后写状态
  const mountedRef = useRef(true);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // 卸载时清理 timer
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const performSave = useCallback(async (patch: Partial<AppConfig>): Promise<AppSnapshot | null> => {
    try {
      const next = await window.obsGuard.saveConfig(patch);
      if (mountedRef.current) {
        setSaveState('saved');
        onSavedRef.current?.(next);
      }
      return next;
    } catch {
      if (mountedRef.current) {
        setSaveState('error');
      }
      return null;
    }
  }, []);

  const scheduleSave = useCallback(
    (patch: Partial<AppConfig>) => {
      pendingPatchRef.current = {
        ...pendingPatchRef.current,
        ...patch
      };
      if (mountedRef.current) {
        setSaveState('saving');
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        const pending = pendingPatchRef.current;
        pendingPatchRef.current = {};
        void performSave(pending);
      }, SAVE_DEBOUNCE_MS);
    },
    [performSave]
  );

  const flushSave = useCallback(
    async (patch: Partial<AppConfig>): Promise<AppSnapshot> => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingPatchRef.current = {};
      if (mountedRef.current) {
        setSaveState('saving');
      }
      try {
        const next = await window.obsGuard.saveConfig(patch);
        if (mountedRef.current) {
          setSaveState('saved');
          onSavedRef.current?.(next);
        }
        return next;
      } catch (err) {
        if (mountedRef.current) {
          setSaveState('error');
        }
        throw err;
      }
    },
    []
  );

  return { saveState, scheduleSave, flushSave };
};
