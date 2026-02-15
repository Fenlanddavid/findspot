import React, { useState, useEffect, useRef } from "react";
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
    return () => URL.revokeObjectURL(u);
  }, [media.blob]);

  const updateScale = () => {
    if (!imgRef.current || !media.pxPerMm) return;

    const { naturalWidth, naturalHeight, clientWidth, clientHeight } = imgRef.current;
    
    // Determine the scale factor applied to the image.
    // If object-cover is used, the image is scaled to the larger of the two ratios.
    // If no object-fit is used, or it's 'fill', it's just clientWidth/naturalWidth.
    const style = window.getComputedStyle(imgRef.current);
    const objectFit = style.objectFit;

    let scale = clientWidth / naturalWidth;

    if (objectFit === "cover") {
      scale = Math.max(clientWidth / naturalWidth, clientHeight / naturalHeight);
    } else if (objectFit === "contain") {
      scale = Math.min(clientWidth / naturalWidth, clientHeight / naturalHeight);
    }

    setDisplayPxPerMm(media.pxPerMm * scale);
  };

  // Re-calculate on window resize
  useEffect(() => {
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [media.pxPerMm]);

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
