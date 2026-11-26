// A scene tile's frame: it runs only while the tile is on screen or near it, and after a shared theme
// changes it reloads in its turn (stagger.ts), not together with every other tile.
import { useEffect, useRef, useState } from "react";
import { type Stagger, tileReloads } from "./stagger";

/** How far outside the screen a tile starts its scene, so one scrolled to is usually ready. */
const NEAR_SCREEN = "300px";

/** Whether `el` is on screen or within NEAR_SCREEN of it. Without IntersectionObserver, always. */
export function useNearScreen(el: Element | null): boolean {
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setNear(entries.at(-1)!.isIntersecting), { rootMargin: NEAR_SCREEN });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return near;
}

const onScreen = (el: Element | null) => {
  const r = el?.getBoundingClientRect();
  return !!r && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
};

/**
 * Which file a tile shows and which version of it: a Customize or Revert swaps the tile's path in
 * place, which must count as its own file changing even when both versions are 0.
 */
export const ownFile = (path: string, versions: Record<string, number>) => `${path}@${versions[path] ?? 0}`;

/**
 * The url a tile's frame shows, given the url it should show (`wanted`) and which file and version
 * of it is its own (`own`, from ownFile). Its own file changing, or another file taking the
 * tile's place (a Customize or Revert swaps the path in place), loads straight away; a change to the
 * shared theme only (every tile's url at once) waits its turn in `reloads`. A tile that isn't near
 * the screen has no frame, so it just takes the new url.
 */
export function useTileSrc(wanted: string, own: string, el: Element | null, near: boolean, reloads: Stagger = tileReloads): string {
  const [src, setSrc] = useState(wanted);
  const shownOwn = useRef(own);
  useEffect(() => {
    if (wanted === src) return;
    const take = () => {
      shownOwn.current = own;
      setSrc(wanted);
    };
    if (!near || own !== shownOwn.current) return take();
    return reloads.request(take, () => onScreen(el));
  }, [wanted, near]);
  return src;
}
