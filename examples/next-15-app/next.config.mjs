import { withIterate } from "iterate-ui-next";

/** @type {import('next').NextConfig} */
const nextConfig = {};

// appName matches the "name" in iterate's .iterate/config.json apps[] so
// iterations created from this dev server spawn the next-15 example (not
// whatever the first/default app is).
export default withIterate(nextConfig, { appName: "next-15-example" });
