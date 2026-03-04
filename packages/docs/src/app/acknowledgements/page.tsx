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
        <strong>iterate</strong> builds on foundational agent-interface ideas from the{" "}
        <a href="https://agentation.dev" target="_blank" rel="noopener noreferrer">
          Agentation
        </a>{" "}
        team. Their work on the annotation framework — the concept of selecting UI elements,
        attaching structured feedback, and handing that context to AI agents — helped shape
        the core interaction loop that makes <strong>iterate</strong> so efficient to interface with.
      </p>
      <p>
        The idea that a visual overlay can bridge the gap between what a human sees and what
        an agent needs to know is central to both projects. We&apos;re grateful for their
        pioneering work in this space.
      </p>

      <h2>Open source</h2>
      <p>
        <strong>iterate</strong> is built with open-source tools:
      </p>
      <ul>
        <li><a href="https://react.dev" target="_blank" rel="noopener noreferrer">React</a> — powers the overlay UI</li>
        <li><a href="https://fastify.dev" target="_blank" rel="noopener noreferrer">Fastify</a> — the daemon server</li>
        <li><a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol</a> — the bridge between <strong>iterate</strong> and AI agents</li>
        <li><a href="https://nextjs.org" target="_blank" rel="noopener noreferrer">Next.js</a> and <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">Vite</a> — supported frameworks via adapter plugins</li>
      </ul>
    </>
  );
}
