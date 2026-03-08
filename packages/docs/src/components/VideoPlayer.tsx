"use client";

import { useCallback, useRef, useState } from "react";

interface VideoPlayerProps {
  src: string;
  aspectRatio: string;
}

export function VideoPlayer({ src, aspectRatio }: VideoPlayerProps) {
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleRef = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el && el.readyState >= 2) {
      setLoaded(true);
    }
  }, []);

  return (
    <div style={{
      position: "relative",
      width: "100%",
      aspectRatio,
      borderRadius: "16px",
      overflow: "hidden",
      marginBottom: "2rem",
    }}>
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--color-bg-code)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(90deg, transparent 0%, var(--color-border) 50%, transparent 100%)",
              animation: "shimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}
      <video
        ref={handleRef}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        onLoadedData={() => setLoaded(true)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
