import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "iterate",
    short_name: "iterate",
    description: "A visual feedback tool for AI-assisted development.",
    start_url: "/",
    display: "browser",
    theme_color: "#000000",
    background_color: "#000000",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "32x32",
        type: "image/x-icon",
      },
    ],
  };
}
