import styles from "./Callout.module.css";

interface CalloutProps {
  label?: string;
  children: React.ReactNode;
}

export function Callout({ label = "Note", children }: CalloutProps) {
  return (
    <aside className={styles.callout}>
      <div className={styles.label}>{label}</div>
      {children}
    </aside>
  );
}
