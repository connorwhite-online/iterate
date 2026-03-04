import styles from "./Logo.module.css";

export function Logo() {
  return (
    <div className={styles.container} aria-label="iterate">
      <span className={styles.spacer}>iterate</span>
      <span className={`${styles.fork} ${styles.fork1}`}>iterate</span>
      <span className={`${styles.fork} ${styles.fork2}`}>iterate</span>
      <span className={`${styles.fork} ${styles.fork3}`}>iterate</span>
    </div>
  );
}
