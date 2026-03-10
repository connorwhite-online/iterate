import { execa, type ResultPromise } from "execa";
import { createServer, createConnection } from "node:net";

/** Max lines of stdout/stderr to retain per process for error reporting */
const MAX_LOG_LINES = 30;

interface ManagedProcess {
  name: string;
  port: number;
  process: ResultPromise;
  pid: number | undefined;
  /** Rolling buffer of recent output lines (stdout + stderr) */
  recentOutput: string[];
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private nextPort: number;
  private maxPort: number;

  constructor(basePort: number) {
    this.nextPort = basePort;
    this.maxPort = basePort + 99;
  }

  /** Find an available port starting from the next in range */
  async allocatePort(): Promise<number> {
    for (let port = this.nextPort; port <= this.maxPort; port++) {
      const available = await this.isPortAvailable(port);
      if (available) {
        this.nextPort = port + 1;
        return port;
      }
    }
    throw new Error(
      `No available ports in range ${this.nextPort - 99}-${this.maxPort}`
    );
  }

  /** Start a dev server in the given working directory */
  async start(
    name: string,
    cwd: string,
    command: string,
    port: number
  ): Promise<{ pid: number | undefined }> {
    const [cmd, ...args] = command.split(" ");

    const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), ITERATE_ITERATION_NAME: name };
    // Remove TURBOPACK env inherited from the parent Next.js 16 process
    // so it doesn't conflict with --webpack in monorepo iterations.
    delete env.TURBOPACK;

    const child = execa(cmd!, args, {
      cwd,
      env,
      extendEnv: false,
      stdout: "pipe",
      stderr: "pipe",
    });

    const recentOutput: string[] = [];

    const pushLine = (line: string) => {
      recentOutput.push(line);
      if (recentOutput.length > MAX_LOG_LINES) recentOutput.shift();
    };

    // Log dev server output with prefix and capture for error reporting
    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        console.log(`[${name}] ${line}`);
        pushLine(line);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        console.error(`[${name}] ${line}`);
        pushLine(line);
      }
    });

    // Clean up map entry if process exits unexpectedly
    child.then(
      () => this.processes.delete(name),
      () => this.processes.delete(name)
    );

    this.processes.set(name, {
      name,
      port,
      process: child,
      pid: child.pid,
      recentOutput,
    });

    return { pid: child.pid };
  }

  /** Stop a specific dev server, waiting for exit with SIGKILL fallback */
  async stop(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed) return;

    managed.process.kill("SIGTERM");

    try {
      // Wait up to 5s for graceful shutdown
      await Promise.race([
        managed.process.catch(() => {}),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000)
        ),
      ]);
    } catch {
      // Force kill if it didn't shut down
      try {
        managed.process.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }

    this.processes.delete(name);
  }

  /** Stop all managed dev servers */
  async stopAll(): Promise<void> {
    const names = [...this.processes.keys()];
    await Promise.all(names.map((name) => this.stop(name)));
  }

  /** Get info about a running process */
  getProcess(name: string): ManagedProcess | undefined {
    return this.processes.get(name);
  }

  /** Get recent stdout/stderr output for a process (for error reporting) */
  getRecentOutput(name: string): string[] {
    return this.processes.get(name)?.recentOutput ?? [];
  }

  /**
   * Wait for a dev server to start accepting connections.
   * Polls the port with TCP connect attempts until it responds or timeout.
   */
  async waitForReady(port: number, timeoutMs = 120000): Promise<void> {
    const start = Date.now();
    const interval = 500;

    while (Date.now() - start < timeoutMs) {
      const listening = await this.isPortListening(port);
      if (listening) return;
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Dev server on port ${port} did not start within ${timeoutMs / 1000}s`);
  }

  /** Check if something is listening on a port (TCP connect probe) */
  private isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      socket.setTimeout(1000);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
    });
  }

  /** Check if a port is available */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
  }
}
