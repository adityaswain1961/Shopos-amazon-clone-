import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Monorepo: trace dependencies from the workspace root so the standalone
  // bundle includes hoisted node_modules.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
  compress: true,
  images: {
    // Product images are already resized to WebP on upload and served from
    // the CDN/object storage. Re-optimising them in Next.js would burn CPU on
    // every web pod for no benefit — the cheapest image server is none.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // hashed build assets never change → cache forever at the CDN/browser
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
