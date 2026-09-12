import { useEffect } from 'react';

/** Measure navigation and the visible keyboard viewport instead of assuming a phone height. */
export function useRecordingViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    const saveBar = document.querySelector<HTMLElement>('.record-save-bar');
    const viewport = window.visualViewport;
    const update = () => {
      const keyboard = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0;
      root.style.setProperty('--record-keyboard', `${keyboard}px`);
      root.style.setProperty('--record-save-height', `${saveBar?.getBoundingClientRect().height ?? 0}px`);
      root.style.setProperty('--record-nav', `${nav?.getBoundingClientRect().height ?? 0}px`);
    };
    const observer = new ResizeObserver(update);
    if (nav) observer.observe(nav);
    if (saveBar) observer.observe(saveBar);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); root.style.removeProperty('--record-keyboard'); root.style.removeProperty('--record-nav'); root.style.removeProperty('--record-save-height'); };
  }, []);
}
