export interface NavLink {
  title: string;
  href: string;
}

export interface NavSection {
  title?: string;
  links: NavLink[];
}

export const navigation: NavSection[] = [
  {
    links: [
      { title: "Introduction", href: "/" },
      { title: "Installation", href: "/installation" },
      { title: "Tools", href: "/toolbar" },
      { title: "Worktrees", href: "/worktree-workflow" },
      { title: "Providing Context", href: "/providing-context" },
      { title: "Commands & CLI", href: "/commands" },
    ],
  },
  {
    links: [
      { title: "Acknowledgements", href: "/acknowledgements" },
    ],
  },
];
