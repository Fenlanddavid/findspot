import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './workers/findspot-static/wrangler.toml',
      },
    }),
  ],
  test: {
    include: ['tests/worker/**/*.test.ts'],
  },
});
