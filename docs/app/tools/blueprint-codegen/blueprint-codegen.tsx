"use client"

import { useState } from "react"
import { Blueprint } from "@evolution-sdk/evolution"
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock"

const { PlutusBlueprint, generateTypeScript, createCodegenConfig } = Blueprint

export function BlueprintCodegen() {
  const [blueprintJson, setBlueprintJson] = useState("")
  const [generatedCode, setGeneratedCode] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [optionStyle, setOptionStyle] = useState<"NullOr" | "UndefinedOr" | "Union">("UndefinedOr")
  const [moduleStrategy, setModuleStrategy] = useState<"flat" | "namespaced">("namespaced")
  const [unionStyle, setUnionStyle] = useState<"Variant" | "Struct" | "TaggedStruct">("Variant")

  const generateTypes = async () => {
    setError(null)
    setGeneratedCode("")

    try {
      const cleanJson = blueprintJson.trim()

      if (!cleanJson) {
        setError("Please enter a Plutus Blueprint JSON")
        return
      }

      // Parse the JSON
      const plutusJson = JSON.parse(cleanJson)

      // Create config
      const config = createCodegenConfig({
        optionStyle,
        moduleStrategy,
        unionStyle,
        useRelativeRefs: true,
        emptyConstructorStyle: "Literal"
      })

      // Generate TypeScript code
      const code = generateTypeScript(plutusJson, config)

      setGeneratedCode(code)
    } catch (err) {
      console.error("Generation error:", err)
      setError(err instanceof Error ? err.message : "Failed to generate types from blueprint")
    }
  }

  const downloadCode = () => {
    if (!generatedCode) return

    const blob = new Blob([generatedCode], { type: "text/typescript" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "generated-types.ts"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = async () => {
    if (!generatedCode) return

    try {
      await navigator.clipboard.writeText(generatedCode)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  const loadSample = async () => {
    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
      const response = await fetch(`${basePath}/sample-blueprint.json`)
      if (!response.ok) {
        throw new Error("Failed to load sample blueprint")
      }
      const sampleJson = await response.json()
      setBlueprintJson(JSON.stringify(sampleJson, null, 2))
      setError(null)
    } catch (err) {
      console.error("Failed to load sample:", err)
      setError(err instanceof Error ? err.message : "Failed to load sample blueprint")
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="text-2xl font-semibold tracking-tight">Blueprint Input</h3>
              <p className="text-sm text-muted-foreground">Paste your plutus.json blueprint</p>
            </div>
            <button
              onClick={loadSample}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-6 py-2 bg-zinc-700 text-white hover:bg-zinc-600 active:bg-zinc-500 transition-all cursor-pointer shadow-sm hover:shadow"
            >
              Load Sample
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label htmlFor="option-style" className="text-sm font-medium leading-none">
                  Option Style
                </label>
                <select
                  id="option-style"
                  value={optionStyle}
                  onChange={(e) => setOptionStyle(e.target.value as any)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="UndefinedOr">UndefinedOr</option>
                  <option value="NullOr">NullOr</option>
                  <option value="Union">Union</option>
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="module-strategy" className="text-sm font-medium leading-none">
                  Module Strategy
                </label>
                <select
                  id="module-strategy"
                  value={moduleStrategy}
                  onChange={(e) => setModuleStrategy(e.target.value as any)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="namespaced">Namespaced</option>
                  <option value="flat">Flat</option>
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="union-style" className="text-sm font-medium leading-none">
                  Union Style
                </label>
                <select
                  id="union-style"
                  value={unionStyle}
                  onChange={(e) => setUnionStyle(e.target.value as any)}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="Variant">Variant</option>
                  <option value="Struct">Struct (verbose)</option>
                  <option value="TaggedStruct">TaggedStruct</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="blueprint-json" className="text-sm font-medium leading-none">
                Blueprint JSON
              </label>
              <textarea
                id="blueprint-json"
                value={blueprintJson}
                onChange={(e) => setBlueprintJson(e.target.value)}
                placeholder="Paste your plutus.json content here..."
                className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <button
              onClick={generateTypes}
              className="sm:w-auto w-full inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-6 py-2 bg-zinc-700 text-white hover:bg-zinc-600 active:bg-zinc-500 transition-all cursor-pointer shadow-sm hover:shadow"
            >
              Generate Types
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <div className="flex gap-3">
              <svg className="h-5 w-5 text-destructive shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1 min-w-0 space-y-2">
                <p className="text-sm font-medium text-destructive">Error generating types</p>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words overflow-wrap-anywhere font-mono">
                  {error}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {generatedCode && (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Generated TypeScript</h4>
              <div className="flex gap-2">
                <button
                  onClick={copyToClipboard}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium h-8 px-3 py-1 bg-zinc-700 text-white hover:bg-zinc-600 active:bg-zinc-500 transition-all cursor-pointer shadow-sm"
                >
                  Copy
                </button>
                <button
                  onClick={downloadCode}
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium h-8 px-3 py-1 bg-zinc-700 text-white hover:bg-zinc-600 active:bg-zinc-500 transition-all cursor-pointer shadow-sm"
                >
                  Download
                </button>
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              <DynamicCodeBlock lang="ts" code={generatedCode} />
            </div>
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-border/50">
        <p className="text-xs text-center text-muted-foreground">
          Questions or feedback?{" "}
          <a
            href="https://github.com/IntersectMBO/evolution-sdk/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Start a discussion on GitHub
          </a>
        </p>
      </div>
    </div>
  )
}
