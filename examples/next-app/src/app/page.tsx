"use client";

import { useState } from "react";

export default function Home() {
  const [count, setCount] = useState(0);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>iterate</h1>
        <p style={styles.subtitle}>
          Test app for visual iteration with git worktrees
        </p>
      </header>

      <main style={styles.main}>
        {/* Flex container — good for testing drag-to-reorder */}
        <div style={styles.cardGrid}>
          <Card
            title="Annotations"
            description="Circle elements and add comments. Try switching to Annotate mode in the toolbar."
            color="#888"
          />
          <Card
            title="Element Inspector"
            description="Select mode highlights elements on hover with their CSS selector."
            color="#aaa"
          />
          <Card
            title="DOM Manipulation"
            description="Move mode lets you drag flex children and absolutely positioned elements."
            color="#666"
          />
        </div>

        {/* Interactive element — good for testing annotations */}
        <div style={styles.counterSection}>
          <button
            onClick={() => setCount((c) => c + 1)}
            style={styles.button}
          >
            Count: {count}
          </button>
          <p style={styles.hint}>
            Try annotating this button with a suggestion like &quot;make this bigger&quot;
          </p>
        </div>

      </main>

      <footer style={styles.footer}>
        <p>iterate example app (Next.js)</p>
      </footer>
    </div>
  );
}

function Card({
  title,
  description,
  color,
}: {
  title: string;
  description: string;
  color: string;
}) {
  return (
    <div style={{ ...styles.card, borderTopColor: color }}>
      <h3 style={{ ...styles.cardTitle, color }}>{title}</h3>
      <p style={styles.cardDescription}>{description}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#0a0a0a",
    color: "#fafafa",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    textAlign: "center",
    padding: "48px 24px 24px",
  },
  title: {
    fontSize: 40,
    fontWeight: 700,
    margin: 0,
    color: "#e0e0e0",
  },
  subtitle: {
    color: "#888",
    marginTop: 8,
    fontSize: 16,
  },
  main: {
    flex: 1,
    padding: "24px 48px",
    position: "relative",
  },
  cardGrid: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  card: {
    background: "transparent",
    borderRadius: 8,
    padding: 16,
    width: 240,
    borderTop: "2px solid",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    margin: "0 0 6px 0",
  },
  cardDescription: {
    color: "#bbb",
    fontSize: 13,
    lineHeight: 1.5,
    margin: 0,
  },
  counterSection: {
    textAlign: "center" as const,
    marginTop: 48,
  },
  button: {
    background: "#555",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 32px",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
  },
  hint: {
    color: "#666",
    fontSize: 13,
    marginTop: 12,
  },
  footer: {
    textAlign: "center" as const,
    padding: 16,
    color: "#444",
    fontSize: 12,
    borderTop: "1px solid #1a1a1a",
  },
};
