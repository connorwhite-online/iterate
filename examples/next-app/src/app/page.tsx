"use client";

export default function Home() {
  return (
    <div style={styles.container}>
      <Header />

      <main style={styles.main}>
        <div style={styles.dashboardGrid}>
          <PlaceholderA />
          <PlaceholderB />
          <PlaceholderC />
          <PlaceholderD />
          <PlaceholderE />
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header style={styles.header}>
      <div style={styles.headerLeft}>
        <div style={styles.logo} />
        <div style={styles.headerTitle} />
      </div>
      <div style={styles.headerRight}>
        <div style={styles.headerNav} />
        <div style={styles.headerNav} />
        <div style={styles.avatar} />
      </div>
    </header>
  );
}

function PlaceholderA() {
  return (
    <div style={{ ...styles.card, gridColumn: "span 2" }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitle} />
        <div style={styles.cardBadge} />
      </div>
      <div style={styles.chartPlaceholder}>
        <div style={{ ...styles.chartBar, height: "55%" }} />
        <div style={{ ...styles.chartBar, height: "40%" }} />
        <div style={{ ...styles.chartBar, height: "70%" }} />
        <div style={{ ...styles.chartBar, height: "45%" }} />
        <div style={{ ...styles.chartBar, height: "80%" }} />
        <div style={{ ...styles.chartBar, height: "50%" }} />
        <div style={{ ...styles.chartBar, height: "65%" }} />
      </div>
    </div>
  );
}

function PlaceholderB() {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitle} />
      </div>
      <div style={styles.statValue} />
      <div style={styles.statLabel} />
    </div>
  );
}

function PlaceholderC() {
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitle} />
      </div>
      <div style={styles.statValue} />
      <div style={styles.statLabel} />
    </div>
  );
}

function PlaceholderD() {
  return (
    <div style={{ ...styles.card, gridColumn: "span 2" }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitle} />
      </div>
      <div style={styles.listPlaceholder}>
        <div style={styles.listRow} />
        <div style={styles.listRow} />
        <div style={styles.listRow} />
        <div style={styles.listRow} />
      </div>
    </div>
  );
}

function PlaceholderE() {
  const rows = [
    { label: 60, offset: "0%", width: "45%" },
    { label: 80, offset: "15%", width: "55%" },
    { label: 50, offset: "40%", width: "30%" },
    { label: 70, offset: "10%", width: "65%" },
    { label: 40, offset: "55%", width: "35%" },
    { label: 90, offset: "20%", width: "50%" },
  ];

  return (
    <div style={{ ...styles.card, gridColumn: "span 2" }}>
      <div style={styles.cardHeader}>
        <div style={styles.cardTitle} />
        <div style={styles.cardBadge} />
      </div>
      <div style={styles.ganttChart}>
        {rows.map((row, i) => (
          <div key={i} style={styles.ganttRow}>
            <div style={{ ...styles.ganttLabel, width: row.label }} />
            <div style={styles.ganttTrack}>
              <div
                style={{
                  ...styles.ganttBar,
                  marginLeft: row.offset,
                  width: row.width,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
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
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 32px",
    borderBottom: "1px solid #1a1a1a",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: "linear-gradient(135deg, #2563eb, #7c3aed)",
  },
  headerTitle: {
    width: 80,
    height: 12,
    borderRadius: 4,
    background: "#333",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  headerNav: {
    width: 56,
    height: 10,
    borderRadius: 4,
    background: "#262626",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#333",
  },
  main: {
    flex: 1,
    padding: "16px 32px",
  },
  dashboardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 16,
  },
  card: {
    background: "#161616",
    borderRadius: 12,
    border: "1px solid #222",
    padding: 20,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: {
    background: "#333",
    borderRadius: 4,
    width: 100,
    height: 12,
  },
  cardBadge: {
    background: "#1e2d5f",
    borderRadius: 10,
    width: 48,
    height: 20,
  },
  chartPlaceholder: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    height: 100,
  },
  chartBar: {
    flex: 1,
    background: "linear-gradient(180deg, #2563eb, #1e40af)",
    borderRadius: 4,
  },
  statValue: {
    background: "#333",
    borderRadius: 4,
    width: 80,
    height: 28,
    marginBottom: 8,
  },
  statLabel: {
    background: "#262626",
    borderRadius: 4,
    width: 60,
    height: 10,
  },
  listPlaceholder: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  listRow: {
    background: "#1a1a1a",
    borderRadius: 6,
    height: 32,
  },
  ganttChart: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  ganttRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  ganttLabel: {
    height: 10,
    borderRadius: 4,
    background: "#333",
    flexShrink: 0,
  },
  ganttTrack: {
    flex: 1,
    height: 20,
    background: "#1a1a1a",
    borderRadius: 6,
    overflow: "hidden",
  },
  ganttBar: {
    height: "100%",
    background: "linear-gradient(90deg, #2563eb, #7c3aed)",
    borderRadius: 6,
  },
  footer: {
    textAlign: "center" as const,
    padding: 16,
    color: "#444",
    fontSize: 12,
    borderTop: "1px solid #1a1a1a",
  },
};
