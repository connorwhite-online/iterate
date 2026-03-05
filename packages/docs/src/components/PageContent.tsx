import styles from "./PageContent.module.css";

export function PageContent({ children }: { children: React.ReactNode }) {
  return (
    <main className={styles.wrapper}>
      <article className={styles.content}>
        {children}
      </article>
      <footer className={styles.footer}>
        Created by <a href="https://x.com/connor_online" target="_blank" rel="noopener noreferrer">Connor White</a>
      </footer>
    </main>
  );
}
