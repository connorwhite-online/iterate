import { execa, type ResultPromise } from "execa";
import { createServer } from "node:net";

interface ManagedProcess {
  name: string;
  port: number;
  process: ResultPromise;
  pid: number | undefined;
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

    const child = execa(cmd!, args, {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        ITERATE_ITERATION_NAME: name,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Log dev server output with prefix
    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        console.log(`[${name}] ${line}`);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().split("\n").filter(Boolean)) {
        console.error(`[${name}] ${line}`);
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
