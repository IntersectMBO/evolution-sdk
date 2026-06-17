import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from "fumadocs-mdx/config"
import { transformerTwoslash } from "fumadocs-twoslash"
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins"

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections#define-docs
export const docs = defineDocs({
  docs: {
    schema: frontmatterSchema
  },
  meta: {
    schema: metaSchema
  }
})

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      lazy: true, // Load languages and themes on-demand to reduce memory usage
      themes: {
        light: "github-light",
        dark: "github-dark"
      },
      // Explicit language list for lazy loading
      langs: ["ts", "tsx", "js", "jsx", "bash", "sh"],
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        transformerTwoslash({
          twoslashOptions: {
            compilerOptions: {
              types: ["node"]
            }
          }
        })
      ]
    }
  }
})
