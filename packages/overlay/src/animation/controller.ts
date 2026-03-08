/**
 * Animation controller — pause, resume, and scrub all page animations.
 *
 * Captures three categories:
 * 1. Web Animations API (CSS animations, CSS transitions, JS-created animations)
 *    → uses document.getAnimations() + animation.pause()/play()/currentTime
 * 2. requestAnimationFrame-based animations
 *    → monkey-patches rAF to freeze the callback loop when paused
 * 3. CSS animation-play-state fallback
 *    → injects a stylesheet that sets `* { animation-play-state: paused !important }`
 *    and pauses running CSS transitions by snapshotting their computed values.
 */

export interface AnimationSnapshot {
  /** Total number of running animations when paused */
  animationCount: number;
  /** The timeline position (ms) when paused — relative to first animation start */
  timelinePosition: number;
  /** Duration of the longest animation on the page (ms) */
  timelineDuration: number;
  /** Individual animation descriptions for context */
  animations: AnimationInfo[];
}

export interface AnimationInfo {
  /** CSS selector or element description */
  target: string;
  /** "css-animation" | "css-transition" | "web-animation" */
  type: "css-animation" | "css-transition" | "web-animation";
  /** Animation name or transition property */
  name: string;
  /** Current time in ms */
  currentTime: number;
  /** Total duration in ms (Infinity for infinite animations) */
  duration: number;
  /** Play state when captured */
  playState: string;
}

/** Minimal selector for an element (for annotation context) */
function describeElement(el: Element | null): string {
  if (!el) return "(unknown)";
  if (el.id) return `#${el.id}`;
  const classes = Array.from(el.classList).slice(0, 2).join(".");
  const tag = el.tagName.toLowerCase();
  return classes ? `${tag}.${classes}` : tag;
}

/** Get a rough selector for an element */
function getSelector(el: Element | null): string {
  if (!el) return "";
  if (el.id) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).slice(0, 3).join(".");
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName
    );
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      return `${parent.id ? `#${parent.id} > ` : ""}${tag}${classes ? `.${classes}` : ""}:nth-of-type(${idx})`;
    }
  }
  return `${tag}${classes ? `.${classes}` : ""}`;
}

export class AnimationController {
  private paused = false;
  private pauseStyleEl: HTMLStyleElement | null = null;
  private pausedAnimations: Animation[] = [];
  private snapshotTime = 0;
  private timelineDuration = 0;

  // rAF monkey-patch state
  private originalRAF: typeof requestAnimationFrame | null = null;
  private originalCancelRAF: typeof cancelAnimationFrame | null = null;
  private rafQueue: Map<number, FrameRequestCallback> = new Map();
  private rafIdCounter = 0;
  private frozenTimestamp = 0;

  // Document to operate on (supports iframe contexts)
  private doc: Document;
  private win: Window;

  constructor(doc: Document = document, win: Window = window) {
    this.doc = doc;
    this.win = win;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause all animations on the page.
   * Returns a snapshot of the current animation state.
   */
  pause(): AnimationSnapshot {
    if (this.paused) return this.getSnapshot();

    this.paused = true;

    // 1. Pause Web Animations API animations (covers CSS animations + transitions + JS)
    this.pausedAnimations = [];
    try {
      const animations = this.doc.getAnimations();
      for (const anim of animations) {
        if (anim.playState === "running") {
          anim.pause();
          this.pausedAnimations.push(anim);
        }
      }
    } catch {
      // Fallback: older browsers without getAnimations
    }

    // 2. Inject global CSS to pause any animations missed by the API
    this.injectPauseStyles();

    // 3. Freeze requestAnimationFrame
    this.freezeRAF();

    // 4. Build timeline info
    const snapshot = this.buildSnapshot();
    this.snapshotTime = snapshot.timelinePosition;
    this.timelineDuration = snapshot.timelineDuration;

    return snapshot;
  }

  /**
   * Resume all animations.
   */
  resume(): void {
    if (!this.paused) return;

    this.paused = false;

    // 1. Resume paused Web Animations API animations
    for (const anim of this.pausedAnimations) {
      try {
        anim.play();
      } catch {
        // Animation may have been removed
      }
    }
    this.pausedAnimations = [];

    // 2. Remove pause stylesheet
    this.removePauseStyles();

    // 3. Unfreeze rAF
    this.unfreezeRAF();
  }

  /**
   * Scrub all animations to a specific position (0..1 normalized).
   * Only works when paused.
   */
  scrub(position: number): void {
    if (!this.paused) return;

    const clampedPos = Math.max(0, Math.min(1, position));

    // Scrub Web Animations API animations
    for (const anim of this.pausedAnimations) {
      try {
        const effect = anim.effect;
        if (!effect) continue;
        const timing = effect.getComputedTiming();
        const duration = typeof timing.endTime === "number" ? timing.endTime : 0;
        if (duration > 0 && isFinite(duration)) {
          anim.currentTime = clampedPos * duration;
        }
      } catch {
        // Skip animations that can't be scrubbed
      }
    }

    // Update frozen rAF timestamp for JS animations that read it
    if (this.timelineDuration > 0) {
      this.frozenTimestamp = clampedPos * this.timelineDuration;
    }
  }

  /**
   * Get the current snapshot without changing state.
   */
  getSnapshot(): AnimationSnapshot {
    return this.buildSnapshot();
  }

  /**
   * Clean up — restore everything.
   */
  destroy(): void {
    if (this.paused) {
      this.resume();
    }
  }

  // --- Internal helpers ---

  private buildSnapshot(): AnimationSnapshot {
    const infos: AnimationInfo[] = [];
    let maxDuration = 0;
    let maxCurrentTime = 0;

    try {
      const allAnimations = this.doc.getAnimations();
      for (const anim of allAnimations) {
        const effect = anim.effect;
        if (!effect) continue;
        const timing = effect.getComputedTiming();
        const target =
          effect instanceof KeyframeEffect ? effect.target : null;

        const currentTime =
          typeof anim.currentTime === "number" ? anim.currentTime : 0;
        const duration =
          typeof timing.endTime === "number" && isFinite(timing.endTime)
            ? timing.endTime
            : typeof timing.duration === "number" && isFinite(timing.duration)
              ? timing.duration
              : 0;

        // Determine type
        let type: AnimationInfo["type"] = "web-animation";
        let name = "(unnamed)";

        if (anim instanceof CSSAnimation) {
          type = "css-animation";
          name = anim.animationName;
        } else if (anim instanceof CSSTransition) {
          type = "css-transition";
          name = anim.transitionProperty;
        } else {
          name =
            (effect instanceof KeyframeEffect
              ? describeElement(effect.target as Element)
              : "(script)") + " animation";
        }

        infos.push({
          target: getSelector(target as Element | null),
          type,
          name,
          currentTime,
          duration,
          playState: anim.playState,
        });

        if (duration > maxDuration) maxDuration = duration;
        if (currentTime > maxCurrentTime) maxCurrentTime = currentTime;
      }
    } catch {
      // getAnimations not supported
    }

    return {
      animationCount: infos.length,
      timelinePosition: maxCurrentTime,
      timelineDuration: maxDuration || 1000,
      animations: infos,
    };
  }

  private injectPauseStyles(): void {
    if (this.pauseStyleEl) return;
    const style = this.doc.createElement("style");
    style.setAttribute("data-iterate-pause", "");
    style.textContent = `
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `;
    this.doc.head.appendChild(style);
    this.pauseStyleEl = style;
  }

  private removePauseStyles(): void {
    if (this.pauseStyleEl) {
      this.pauseStyleEl.remove();
      this.pauseStyleEl = null;
    }
  }

  private freezeRAF(): void {
    if (this.originalRAF) return; // Already frozen
    this.originalRAF = this.win.requestAnimationFrame.bind(this.win);
    this.originalCancelRAF = this.win.cancelAnimationFrame.bind(this.win);
    this.frozenTimestamp = performance.now();

    // Replace rAF with a version that queues but never fires
    this.win.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      const id = ++this.rafIdCounter;
      this.rafQueue.set(id, cb);
      return id;
    };

    this.win.cancelAnimationFrame = (id: number): void => {
      this.rafQueue.delete(id);
    };
  }

  private unfreezeRAF(): void {
    if (!this.originalRAF) return;
    this.win.requestAnimationFrame = this.originalRAF;
    this.win.cancelAnimationFrame = this.originalCancelRAF!;

    // Flush queued rAF callbacks by scheduling them with the real rAF
    const queued = Array.from(this.rafQueue.values());
    this.rafQueue.clear();
    for (const cb of queued) {
      this.originalRAF(cb);
    }

    this.originalRAF = null;
    this.originalCancelRAF = null;
  }
}
