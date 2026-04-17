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
  /** Set to true once the child process exits (success or failure) */
  exited: boolean;
  /** Exit code of the child process (null while running) */
  exitCode: number | null;
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private nextPort: number;
  private maxPort: number;

  constructor(basePort: number) {
    this.nextPort = basePort;
    this.maxPort = basePort + 99;
  }

  /**
   * Find an available port starting from the next in range.
   *
   * Race-safe against concurrent callers: we bump `nextPort` BEFORE the
   * async port probe so a second caller that enters the loop mid-await
   * sees a different starting port. Without this, two iterations created
   * back-to-back via /api/command would both pick up the same port.
   */
  async allocatePort(): Promise<number> {
    while (this.nextPort <= this.maxPort) {
      const port = this.nextPort;
      this.nextPort = port + 1; // reserve eagerly
      if (await this.isPortAvailable(port)) return port;
    }
    throw new Error(
      `No available ports in range ${this.nextPort - 100}-${this.maxPort}`
    );
  }

  /** Start a dev server in the given working directory */
  async start(
    name: string,
    cwd: string,
    command: string,
    port: number,
    extraEnv?: Record<string, string>
  ): Promise<{ pid: number | undefined }> {
    const [cmd, ...args] = command.split(" ");

    const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), ITERATE_ITERATION_NAME: name, ...extraEnv };
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

    const managed: ManagedProcess = {
      name,
      port,
      process: child,
      pid: child.pid,
      recentOutput,
      exited: false,
      exitCode: null,
    };

    // Mark as exited but keep the entry so recentOutput survives for error reporting.
    // Callers (stop, waitForReady) check `exited` and clean up the map themselves.
    child.then(
      (result) => { managed.exited = true; managed.exitCode = result.exitCode ?? 0; },
      (err) => { managed.exited = true; managed.exitCode = err.exitCode ?? 1; }
    );

    this.processes.set(name, managed);

    return { pid: child.pid };
  }

  /** Stop a specific dev server, waiting for exit with SIGKILL fallback */
  async stop(name: string): Promise<void> {
    const managed = this.processes.get(name);
    if (!managed) return;

    if (!managed.exited) {
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
   * Polls the port with TCP connect attempts until it responds, the process
   * exits, or the timeout is reached.
   */
  async waitForReady(name: string, port: number, timeoutMs = 120000): Promise<void> {
    const start = Date.now();
    const interval = 500;

    while (Date.now() - start < timeoutMs) {
      // Fail fast if the process has already exited
      const managed = this.processes.get(name);
      if (managed?.exited) {
        const output = managed.recentOutput.join("\n");
        throw new Error(
          `Dev server exited with code ${managed.exitCode} before becoming ready` +
          (output ? `\n\nDev server output:\n${output}` : "")
        );
      }

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
