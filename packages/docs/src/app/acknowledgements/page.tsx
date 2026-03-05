import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acknowledgements",
  description: "Credits and acknowledgements for the iterate project.",
};

export default function AcknowledgementsPage() {
  return (
    <>
      <h1>Acknowledgements</h1>

      <h2>Agentation</h2>
      <p>
        <strong>iterate</strong> builds on the foundational agent-interface that the{" "}
        <a href="https://agentation.dev" target="_blank" rel="noopener noreferrer">
          Agentation
        </a>{" "}
        team pioneered. Their work on the Annotation Format Schema (AFS), as well as many of the
        UI patterns that <strong>iterate</strong> uses as core components of the worktree iteration loop,
        would not have been possible without their meticulous efforts and ideation.
      </p>

      <h2>Open source</h2>
      <p>
        <strong>iterate</strong> is built with open-source tools:
      </p>
      <ul>
        <li><a href="https://react.dev" target="_blank" rel="noopener noreferrer">React</a> — powers the overlay UI</li>
        <li><a href="https://fastify.dev" target="_blank" rel="noopener noreferrer">Fastify</a> — the daemon server</li>
        <li><a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol (MCP)</a> — the bridge between <strong>iterate</strong> and AI agents</li>
        <li><a href="https://nextjs.org" target="_blank" rel="noopener noreferrer">Next.js</a> and <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">Vite</a> — supported frameworks via adapter plugins</li>
      </ul>
    </>
  );
}
