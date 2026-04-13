import React, { useState, useEffect, useRef, useCallback } from "react";
import { Media } from "../db";
import { ScaleBar } from "./ScaleBar";

interface ScaledImageProps {
  media: Media;
  className?: string;
  imgClassName?: string;
  showScale?: boolean;
}

export function ScaledImage({ media, className, imgClassName, showScale = true }: ScaledImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [displayPxPerMm, setDisplayPxPerMm] = useState<number | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(media.blob);
    setUrl(u);
    return () => {
        // Only revoke if we're not currently printing
        // (This is a heuristic, but helps with some browser print flows)
        if (!window.matchMedia('print').matches) {
            URL.revokeObjectURL(u);
        }
    };
  }, [media.blob]);

  const updateScale = useCallback(() => {
    if (!imgRef.current || !media.pxPerMm) return;

    const { naturalWidth, naturalHeight, clientWidth, clientHeight } = imgRef.current;
    const objectFit = window.getComputedStyle(imgRef.current).objectFit;

    let scale = clientWidth / naturalWidth;
    if (objectFit === "cover") {
      scale = Math.max(clientWidth / naturalWidth, clientHeight / naturalHeight);
    } else if (objectFit === "contain") {
      scale = Math.min(clientWidth / naturalWidth, clientHeight / naturalHeight);
    }

    setDisplayPxPerMm(media.pxPerMm * scale);
  }, [media.pxPerMm]);

  // Re-calculate on window resize
  useEffect(() => {
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [updateScale]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {url && (
        <img
          ref={imgRef}
          src={url}
          alt={media.filename}
          className={`w-full h-full ${imgClassName}`}
          onLoad={updateScale}
        />
      )}
      {showScale && displayPxPerMm && (
        <div className="absolute bottom-2 right-2 pointer-events-none">
          <ScaleBar pxPerMm={displayPxPerMm} />
        </div>
      )}
    </div>
  );
}
