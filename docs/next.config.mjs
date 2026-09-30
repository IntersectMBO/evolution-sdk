import { createMDX } from "fumadocs-mdx/next"

const withMDX = createMDX()

const isCI = !!process.env.GITHUB_ACTIONS
const basePath = isCI ? '/evolution-sdk' : ''
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // required for GitHub Pages static export
  output: 'export',
  distDir: 'out',
  // when running in CI for GitHub Pages, set basePath/assetPrefix
  basePath,
  assetPrefix: basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['typescript', 'twoslash'],
  turbopack: {
    // Redirect imports to use built dist/ instead of src/ TypeScript files
    resolveAlias: {
      '@evolution-sdk/evolution': '../packages/evolution/dist/index.js',
    },
  },
}

export default withMDX(config)
