import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets this fixed development tunnel receive Next's HMR and dev assets.
  allowedDevOrigins: [
    'francisca-hawknosed-polyphyletically.ngrok-free.dev',
    'd63b-103-106-232-52.ngrok-free.app',
    '54cc-103-106-232-52.ngrok-free.app',
  ],
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
