import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "iterate — Example App",
  description: "Test app for visual iteration with git worktrees",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
