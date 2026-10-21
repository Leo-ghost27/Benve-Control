/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    // Phase 2 routes are specified as /app/...; the authenticated workspace
    // lives under /dashboard. Keep both addresses working.
    return [{ source: "/app/:path*", destination: "/dashboard/:path*", permanent: false }];
  },
};

export default nextConfig;
