import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { IterateDevTools } from "iterate-ui-next/devtools";
import { FloatingNav, MobileNav } from "@/components/FloatingNav";
import { PageContent } from "@/components/PageContent";
import "./globals.css";

const description = "A visual feedback tool for AI-assisted development. Select elements, annotate intent, drag to reposition — then hand structured context to any AI agent.";

export const metadata: Metadata = {
  title: {
    default: "iterate",
    template: "%s | iterate",
  },
  description,
  icons: { icon: "/favicon.ico" },
  metadataBase: new URL("https://iterate-ui.com"),
  keywords: ["iterate", "AI", "visual feedback", "UI development", "Claude Code", "git worktrees", "design iteration", "MCP"],
  authors: [{ name: "iterate" }],
  creator: "iterate",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "iterate",
    title: "iterate",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "iterate",
    description,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <MobileNav />
        <FloatingNav />
        <PageContent>{children}</PageContent>
        <Analytics />
        <IterateDevTools />
      </body>
    </html>
  );
}
