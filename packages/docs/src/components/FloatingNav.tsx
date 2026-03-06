"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/lib/navigation";
import { Logo } from "./Logo";
import styles from "./FloatingNav.module.css";

type Theme = "system" | "light" | "dark";

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored) {
      setTheme(stored);
      applyTheme(stored);
    } else {
      applyTheme("system");
    }
  }, []);

  const cycle = () => {
    setTransitioning(true);
    setTimeout(() => {
      const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
      setTheme(next);
      localStorage.setItem("theme", next);
      applyTheme(next);
      setTransitioning(false);
    }, 150);
  };

  return (
    <button
      className={`${styles.themeToggle} ${transitioning ? styles.themeToggleOut : ""}`}
      onClick={cycle}
      aria-label={`Theme: ${theme}`}
      title={`Theme: ${theme}`}
    >
      {theme === "light" && <SunIcon />}
      {theme === "dark" && <MoonIcon />}
      {theme === "system" && <MonitorIcon />}
    </button>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <span className={`${styles.menuIcon} ${open ? styles.menuIconOpen : ""}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="9" y1="12" x2="15" y2="12" />
        <line x1="12" y1="9" x2="12" y2="15" />
      </svg>
    </span>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "";
    return pathname.startsWith(href);
  };

  return (
    <div className={styles.mobileNav}>
      <div className={styles.mobileHeader}>
        <Link href="/" className={styles.logoLink}>
          <Logo size={28} color="var(--color-text-secondary)" />
        </Link>
        <button
          className={styles.menuButton}
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          <MenuIcon open={open} />
        </button>
      </div>
      <div className={`${styles.mobileBody} ${open ? styles.mobileBodyOpen : ""}`}>
        <div className={styles.mobileBodyInner}>
          <nav className={styles.navLinks}>
            {navigation.flatMap((section) =>
              section.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${styles.link} ${styles.mobileLink} ${isActive(link.href) ? styles.linkActive : ""}`}
                  onClick={() => setOpen(false)}
                >
                  {link.title}
                </Link>
              ))
            )}
          </nav>
          <div className={styles.mobileThemeRow}>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FloatingNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "";
    return pathname.startsWith(href);
  };

  return (
    <aside className={styles.floatingNav}>
      {/* Top section: logo */}
      <div className={styles.header}>
        <Link href="/" className={styles.logoLink}>
          <Logo size={32} color="var(--color-text-secondary)" />
        </Link>
      </div>

      {/* Nav links */}
      <nav className={styles.navLinks}>
        {navigation.flatMap((section) =>
          section.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${styles.link} ${isActive(link.href) ? styles.linkActive : ""}`}
            >
              {link.title}
            </Link>
          ))
        )}
      </nav>

      {/* Theme toggle */}
      <ThemeToggle />
    </aside>
  );
}
