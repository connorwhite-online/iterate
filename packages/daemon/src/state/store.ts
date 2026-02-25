import type {
  IterateState,
  IterateConfig,
  IterationInfo,
  AnnotationData,
  DomChange,
  DEFAULT_CONFIG,
} from "@iterate/core";

/** In-memory state store for the daemon */
export class StateStore {
  private state: IterateState;

  constructor(config: IterateConfig) {
    this.state = {
      config,
      iterations: {},
      annotations: [],
      domChanges: [],
    };
  }

  getState(): IterateState {
    return this.state;
  }

  getConfig(): IterateConfig {
    return this.state.config;
  }

  // --- Iterations ---

  getIterations(): Record<string, IterationInfo> {
    return this.state.iterations;
  }

  getIteration(name: string): IterationInfo | undefined {
    return this.state.iterations[name];
  }

  setIteration(name: string, info: IterationInfo): void {
    this.state.iterations[name] = info;
  }

  removeIteration(name: string): void {
    delete this.state.iterations[name];
  }

  // --- Annotations ---

  getAnnotations(): AnnotationData[] {
    return this.state.annotations;
  }

  addAnnotation(annotation: AnnotationData): void {
    this.state.annotations.push(annotation);
  }

  removeAnnotation(id: string): boolean {
    const idx = this.state.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.state.annotations.splice(idx, 1);
    return true;
  }

  // --- DOM Changes ---

  getDomChanges(): DomChange[] {
    return this.state.domChanges;
  }

  addDomChange(change: DomChange): void {
    this.state.domChanges.push(change);
  }

  clearDomChanges(): void {
    this.state.domChanges = [];
  }
}
