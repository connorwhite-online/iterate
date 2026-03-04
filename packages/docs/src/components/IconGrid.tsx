import styles from "./IconGrid.module.css";

interface IconGridItem {
  icon: React.ReactNode;
  name: string;
  description: string;
}

export function IconGrid({ items }: { items: IconGridItem[] }) {
  return (
    <div className={styles.grid}>
      {items.map((item) => (
        <div key={item.name} className={styles.item}>
          <div className={styles.icon}>{item.icon}</div>
          <div className={styles.info}>
            <span className={styles.name}>{item.name}</span>
            <span className={styles.description}>{item.description}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
