"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/lib/navigation";
import { Logo } from "./Logo";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "";
    return pathname.startsWith(href);
  };

  return (
    <>
      <button
        className={styles.mobileToggle}
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>
        <Link href="/" className={styles.logoLink} onClick={() => setOpen(false)}>
          <Logo />
        </Link>

        <nav className={styles.nav}>
          {navigation.map((section, i) => {
            const isLast = i === navigation.length - 1;
            return (
              <div key={i}>
                {isLast && <div className={styles.spacer} />}
                <div className={styles.section}>
                  {section.title && (
                    <span className={styles.sectionTitle}>{section.title}</span>
                  )}
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`${styles.link} ${isActive(link.href) ? styles.linkActive : ""}`}
                      onClick={() => setOpen(false)}
                    >
                      {link.title}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
