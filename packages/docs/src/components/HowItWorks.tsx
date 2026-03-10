interface Step {
  label: string;
  description: string;
}

const steps: Step[] = [
  { label: "Create", description: "iterations (worktrees) from the press of a button, or enter /iterate:prompt in a Claude session followed by whatever you want to riff on." },
  { label: "Explore", description: "iterations instantly from the toolbar tabs." },
  { label: "Add context", description: "with the select, draw and move tools by pointing at elements and areas to add feedback, or moving them around in real-time." },
  { label: "Pick", description: "a direction and merge changes back to your base branch with a single click." },
  { label: "Repeat", description: "as needed whenever you need to riff on an idea!" },
];

export function HowItWorks() {
  return (
    <section style={{ margin: "2rem 0" }}>
      <h2>How it works</h2>
      <ol>
        {steps.map((step) => (
          <li key={step.label}>
            <strong>{step.label}</strong> {step.description}
          </li>
        ))}
      </ol>
      <p style={{ fontSize: "0.95rem", color: "var(--color-text-secondary)" }}>
        Optimized for <strong style={{ color: "var(--color-text)" }}>Claude Code</strong> with <strong style={{ color: "var(--color-text)" }}>Next.js</strong>, but works with any agent and all React apps using Vite.
      </p>
    </section>
  );
}
