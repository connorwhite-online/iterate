import styles from "./PageContent.module.css";

export function PageContent({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.wrapper}>
      <article className={styles.content}>
        {children}
      </article>
    </main>
  );
}
