import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://iterate-ui.com";
  return [
    { url: `${base}/`, priority: 1.0 },
    { url: `${base}/installation/`, priority: 0.9 },
    { url: `${base}/commands/`, priority: 0.8 },
    { url: `${base}/toolbar/`, priority: 0.8 },
    { url: `${base}/worktree-workflow/`, priority: 0.8 },
    { url: `${base}/providing-context/`, priority: 0.8 },
    { url: `${base}/acknowledgements/`, priority: 0.3 },
  ];
}
