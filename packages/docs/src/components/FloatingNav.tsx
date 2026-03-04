"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/lib/navigation";
import { Logo } from "./Logo";
import styles from "./FloatingNav.module.css";

function NpmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 256 256" fill="none">
      <rect width="256" height="256" rx="0" fill="currentColor" />
      <path d="M42.667 42.667H213.333V213.333H128V85.333H85.333V213.333H42.667V42.667Z" fill="var(--color-bg-nav)" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
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
      {/* Top section: logo + external links */}
      <div className={styles.header}>
        <Link href="/" className={styles.logoLink}>
          <Logo />
        </Link>
        <div className={styles.externalLinks}>
          <a
            href="https://www.npmjs.com/package/iterate-ui"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.externalLink}
            aria-label="npm package"
          >
            <NpmIcon />
          </a>
          <a
            href="https://github.com/connorwhite-online/iterate"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.externalLink}
            aria-label="GitHub repository"
          >
            <GithubIcon />
          </a>
        </div>
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
    </aside>
  );
}
