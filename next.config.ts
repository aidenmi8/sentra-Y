import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Lets a production build run to an isolated dir (NEXT_DIST_DIR=.next-verify)
  // without clobbering a concurrently-running `next dev` server's `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['ws'],
  transpilePackages: ['react-map-gl', 'mapbox-gl', 'maplibre-gl'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    // Pinned to the only hosts the app actually loads remote images from. A
    // wildcard ('**') turns the always-on /_next/image optimizer into an open
    // image proxy that bypasses the SSRF guard and leaks the server's egress IP.
    // Nothing imports next/image today, but this documents intent and stays safe
    // if an <Image> is added later.
    remotePatterns: [
      { protocol: 'https', hostname: 'api.planespotters.net' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
      { protocol: 'https', hostname: 'github.com' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: wss: data: blob:;" },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default nextConfig;
