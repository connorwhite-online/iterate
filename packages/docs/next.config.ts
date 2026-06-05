import type { NextConfig } from "next";
import { withIterate } from "iterate-ui-next";

const config: NextConfig = {
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withIterate(config, { appName: "docs" });
