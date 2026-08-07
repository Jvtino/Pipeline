// Pinned companies — a device-local preference (AsyncStorage), mirroring the
// desktop app's pins. Deliberately NOT server state in v1: pinning is a
// glance-order preference, not data; keeping it local means zero API surface
// and instant response. Key parity with the desktop's `pipeline.pins`.
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "pipeline.pins.v1";

export function usePins(): { pinned: ReadonlySet<string>; isLoaded: boolean; toggle: (company: string) => void } {
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [isLoaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (live && raw) setPinned(new Set(JSON.parse(raw) as string[]));
      })
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);

  const toggle = useCallback((company: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(company)) next.delete(company);
      else next.add(company);
      AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  return { pinned, isLoaded, toggle };
}

/** Pinned groups first, original (server) order preserved within each half. */
export function sortPinnedFirst<T extends { company: string }>(groups: T[], pinned: ReadonlySet<string>): T[] {
  if (!pinned.size) return groups;
  return [...groups.filter((g) => pinned.has(g.company)), ...groups.filter((g) => !pinned.has(g.company))];
}
