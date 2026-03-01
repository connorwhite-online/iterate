"use client";

import { useState } from "react";

export default function Home() {
  return (
    <div style={styles.container}>
      <Header />

      <main style={styles.main}>
        <CardGrid>
          <Placeholder />
          <Placeholder />
          <Placeholder />
        </CardGrid>

        <Counter />
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header style={styles.header}>
      <h1 style={styles.title}>iterate</h1>
      <p style={styles.subtitle}>
        Test app for visual iteration with git worktrees
      </p>
    </header>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div style={styles.cardGrid}>{children}</div>;
}

function Placeholder() {
  return <div style={styles.placeholder} />;
}

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div style={styles.counterSection}>
      <CounterButton count={count} onClick={() => setCount((c) => c + 1)} />
    </div>
  );
}

function CounterButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={styles.button}>
      Count: {count}
    </button>
  );
}

function Footer() {
  return (
    <footer style={styles.footer}>
      <p>iterate example app (Next.js)</p>
    </footer>
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
    background: "linear-gradient(135deg, #2563eb, #7c3aed)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
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
    gap: 20,
    justifyContent: "center",
    flexWrap: "wrap",
  },
  placeholder: {
    background: "#222",
    borderRadius: 12,
    width: 280,
    height: 120,
  },
  counterSection: {
    textAlign: "center" as const,
    marginTop: 48,
  },
  button: {
    background: "#dc2626",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 32px",
    fontSize: 18,
    fontWeight: 600,
    cursor: "pointer",
  },
  footer: {
    textAlign: "center" as const,
    padding: 16,
    color: "#444",
    fontSize: 12,
    borderTop: "1px solid #1a1a1a",
  },
};
