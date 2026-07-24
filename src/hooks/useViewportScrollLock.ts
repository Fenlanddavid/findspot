import { useLayoutEffect } from 'react';

/**
 * Turns a route into a viewport-bound workspace and restores the surrounding
 * document when that workspace unmounts.
 */
export function useViewportScrollLock(enabled = true) {
    useLayoutEffect(() => {
        if (!enabled) return;

        const html = document.documentElement;
        const body = document.body;
        const previous = {
            htmlOverflow: html.style.overflow,
            htmlOverscroll: html.style.overscrollBehavior,
            bodyOverflow: body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
        };

        window.scrollTo(0, 0);
        html.style.overflow = 'hidden';
        html.style.overscrollBehavior = 'none';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';

        return () => {
            html.style.overflow = previous.htmlOverflow;
            html.style.overscrollBehavior = previous.htmlOverscroll;
            body.style.overflow = previous.bodyOverflow;
            body.style.overscrollBehavior = previous.bodyOverscroll;
        };
    }, [enabled]);
}
