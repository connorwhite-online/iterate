import type { SnapshotNode } from "../types/annotations.js";
import { DESIGN_PRINCIPLES, type DesignPrinciple } from "./principles.js";

export { DESIGN_PRINCIPLES, getPrinciple } from "./principles.js";
export type { DesignPrinciple, PrincipleCategory } from "./principles.js";

/**
 * Select the principles relevant to a set of captured nodes, so a critique only
 * evaluates against what's actually on screen. A principle is included when it
 * has no `appliesTo*` constraints (universal), or when any captured node matches
 * one of its style or element constraints.
 */
export function selectPrinciples(nodes: SnapshotNode[]): DesignPrinciple[] {
  const presentStyles = new Set<string>();
  const presentTags = new Set<string>();
  for (const node of nodes) {
    for (const key of Object.keys(node.computedStyles)) presentStyles.add(key);
    if (node.tagName) presentTags.add(node.tagName.toLowerCase());
  }

  return DESIGN_PRINCIPLES.filter((p) => {
    const hasConstraints = !!(p.appliesToStyles?.length || p.appliesToElements?.length);
    if (!hasConstraints) return true;
    const styleMatch = p.appliesToStyles?.some((s) => presentStyles.has(s)) ?? false;
    const elementMatch = p.appliesToElements?.some((t) => presentTags.has(t)) ?? false;
    return styleMatch || elementMatch;
  });
}
