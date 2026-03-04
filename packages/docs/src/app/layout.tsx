import type { Metadata } from "next";
import { FloatingNav } from "@/components/FloatingNav";
import { PageContent } from "@/components/PageContent";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "iterate",
    template: "%s | iterate",
  },
  description: "A visual feedback tool for AI-assisted development. Select elements, annotate intent, drag to reposition — then hand structured context to any AI agent.",
  metadataBase: new URL("https://iterate-ui.com"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <FloatingNav />
        <PageContent>{children}</PageContent>
      </body>
    </html>
  );
}
