import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      flex: 1,
      gap: "1rem",
    }}>
      <Logo size={24} color="var(--color-text-tertiary)" />
      <span style={{ fontSize: "14px", color: "var(--color-text-tertiary)" }}>
        Nothing here.
      </span>
    </div>
  );
}
