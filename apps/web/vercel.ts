import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "vp run --filter @awen/web build",
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --ignore-scripts --filter '@awen/scripts...' --filter '@awen/web...'",
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
