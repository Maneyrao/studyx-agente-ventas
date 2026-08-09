/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['postgres'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
