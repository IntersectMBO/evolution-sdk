import type { CodegenConfig } from "./codegen-config.js"
import { DEFAULT_CODEGEN_CONFIG } from "./codegen-config.js"
import type * as BlueprintTypes from "./types.js"

/**
 * Generate TSchema definitions from a Blueprint
 *
 * @since 2.0.0
 * @category blueprint
 */

/**
 * Convert a definition name to a valid TypeScript identifier (flat mode)
 */
function toIdentifier(name: string): string {
  // Replace slashes with underscores and make PascalCase
  return name
    .split("/")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
    .replace(/[^a-zA-Z0-9_]/g, "_")
}

/**
 * Get namespace path from a definition name
 * e.g., "cardano/address/Credential" -> "cardano/address"
 * e.g., "ByteArray" -> "" (primitive)
 * e.g., "List$cardano/address/Address" -> "List" (wrapper as namespace)
 * e.g., "Option$cardano/address/StakeCredential" -> "Option" (wrapper as namespace)
 * e.g., "Pairs$cardano/assets/AssetName_Int" -> "Pairs" (wrapper as namespace)
 */
function getNamespacePath(name: string): string {
  // Generic wrappers go into their own namespace (Option, List, Pairs)
  if (name.includes("$")) {
    const wrapper = name.split("$")[0]
    return wrapper.toLowerCase()
  }

  const parts = name.split("/")
  if (parts.length === 1) return "" // Primitive
  return parts.slice(0, -1).join("/")
}

/**
 * Get type name from a definition name
 * e.g., "cardano/address/Credential" -> "Credential"
 * e.g., "ByteArray" -> "ByteArray"
 * e.g., "List$cardano/address/Address" -> "OfAddress"
 * e.g., "Option$ByteArray" -> "OfByteArray"
 * e.g., "Pairs$cardano/assets/AssetName_Int" -> "OfAssetName_Int"
 */
function getTypeName(name: string): string {
  // Generic wrappers - create "OfTypeName" to avoid collisions
  if (name.includes("$")) {
    const [wrapper, rest] = name.split("$")
    if (!rest) return wrapper

    // For Pairs: "Pairs$cardano/assets/AssetName_Int" -> "OfAssetName_Int"
    if (wrapper === "Pairs") {
      const typeNames = rest.split("_").map((t) => {
        const parts = t.split("/")
        return parts[parts.length - 1]
      })
      return `Of${typeNames.join("_")}`
    }

    // For List/Option: "OfTypeName"
    const parts = rest.split("/")
    return `Of${parts[parts.length - 1]}`
  }

  const parts = name.split("/")
  return parts[parts.length - 1]
}

/**
 * Convert namespace path to TypeScript namespace reference
 * e.g., "cardano/address" -> "Cardano.Address"
 * e.g., "option" -> "Option"
 * e.g., "list" -> "List"
 */
function toNamespaceRef(namespacePath: string): string {
  if (!namespacePath) return ""

  // Special case for single-word namespaces (option, list, pairs)
  if (!namespacePath.includes("/")) {
    return namespacePath.charAt(0).toUpperCase() + namespacePath.slice(1)
  }

  return namespacePath
    .split("/")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(".")
}

/**
 * Resolve a reference to a type, optionally relative to current namespace
 * @param refName - Full definition name (e.g., "cardano/address/Credential")
 * @param currentNamespace - Current namespace path (e.g., "cardano/address")
 * @param config - Codegen configuration
 * @returns TypeScript reference string
 */
function resolveReference(refName: string, currentNamespace: string, config: CodegenConfig): string {
  // Special case: Data schema is exported as PlutusData
  if (refName === "Data") return "PlutusData"

  if (config.moduleStrategy === "flat") {
    return toIdentifier(refName)
  }

  const refNamespace = getNamespacePath(refName)
  const refType = getTypeName(refName)

  // Primitive type (no namespace)
  if (!refNamespace) {
    return refType
  }

  // Same namespace - use relative reference
  if (config.useRelativeRefs && refNamespace === currentNamespace) {
    return refType
  }

  // Different namespace - fully qualified reference
  const nsRef = toNamespaceRef(refNamespace)
  return `${nsRef}.${refType}`
}

/**
 * Generate TSchema code for a schema definition
 */
function generateTSchema(
  def: BlueprintTypes.SchemaDefinitionType,
  definitions: Record<string, BlueprintTypes.SchemaDefinitionType>,
  config: CodegenConfig,
  currentNamespace: string = "",
  indent: string = config.indent,
  definitionKey?: string
): string {
  // Handle schema references
  if ("$ref" in def) {
    const refPath = def.$ref.replace("#/definitions/", "")
    const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
    // Special case: Data schema is exported as PlutusData
    if (refName === "Data") return "PlutusData"

    const refId = resolveReference(refName, currentNamespace, config)
    return config.useSuspend ? `Schema.suspend(() => ${refId})` : refId
  }

  // Handle Data type (opaque plutus data)
  if ("title" in def && def.title === "Data") {
    return "PlutusData"
  }

  // Handle primitive types
  if ("dataType" in def) {
    switch (def.dataType) {
      case "bytes":
        return "TSchema.ByteArray"

      case "integer":
        return "TSchema.Integer"

      case "constructor": {
        const constructorDef = def as BlueprintTypes.ConstructorDefinitionType

        if (!constructorDef.fields || constructorDef.fields.length === 0) {
          // Empty constructor - use configured style
          if (config.emptyConstructorStyle === "Literal") {
            const tag = constructorDef.title || definitionKey || "Unit"
            const indexOpt =
              constructorDef.index && constructorDef.index !== 0 ? `, { index: ${constructorDef.index} }` : ""
            return `TSchema.Literal("${tag}" as const${indexOpt})`
          }
          return "TSchema.Struct({})"
        }

        // Build struct fields
        const fieldSchemas: Array<string> = []

        for (let i = 0; i < constructorDef.fields.length; i++) {
          const field = constructorDef.fields[i]!
          // Use configured field naming
          const fieldName =
            field.title ||
            (constructorDef.fields.length === 1
              ? config.fieldNaming.singleFieldName
              : config.fieldNaming.multiFieldPattern.replace("{index}", String(i)))

          let fieldSchema: string
          if ("$ref" in field && field.$ref) {
            const refPath = field.$ref.replace("#/definitions/", "")
            const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
            // Use lazy reference for recursive types
            const refId = resolveReference(refName, currentNamespace, config)
            fieldSchema = config.useSuspend ? `Schema.suspend(() => ${refId})` : refId
          } else if (field.schema) {
            fieldSchema = generateTSchema(
              field.schema,
              definitions,
              config,
              currentNamespace,
              indent + config.indent + config.indent
            )
          } else {
            fieldSchema = "PlutusData"
          }

          fieldSchemas.push(`${indent}${config.indent}${config.indent}${fieldName}: ${fieldSchema}`)
        }

        return `TSchema.Struct({\n${fieldSchemas.join(",\n")}\n${indent}${config.indent}})`
      }

      case "list": {
        const listDef = def as BlueprintTypes.ListDefinitionType
        const itemsSchema = listDef.items
        if (!itemsSchema) {
          return "TSchema.Array(PlutusData)"
        }

        const itemType = generateTSchema(
          itemsSchema as BlueprintTypes.SchemaDefinitionType,
          definitions,
          config,
          currentNamespace,
          indent
        )
        // Wrap in Schema.suspend to handle forward references
        return config.useSuspend ? `TSchema.Array(Schema.suspend(() => ${itemType}))` : `TSchema.Array(${itemType})`
      }

      case "map": {
        const mapDef = def as BlueprintTypes.MapDefinitionType
        const keysSchema = mapDef.keys
        const valuesSchema = mapDef.values

        if (!keysSchema || !valuesSchema) {
          return "TSchema.Map(PlutusData, PlutusData)"
        }

        const keyType = generateTSchema(
          keysSchema as BlueprintTypes.SchemaDefinitionType,
          definitions,
          config,
          currentNamespace,
          indent
        )
        const valueType = generateTSchema(
          valuesSchema as BlueprintTypes.SchemaDefinitionType,
          definitions,
          config,
          currentNamespace,
          indent
        )
        // Wrap in Schema.suspend to handle forward references
        return config.useSuspend
          ? `TSchema.Map(Schema.suspend(() => ${keyType}), Schema.suspend(() => ${valueType}))`
          : `TSchema.Map(${keyType}, ${valueType})`
      }

      default:
        return "PlutusData"
    }
  }

  // Handle union types (anyOf)
  if ("anyOf" in def) {
    const unionDef = def as BlueprintTypes.UnionDefinitionType
    const title = "title" in def ? (def as { title?: string }).title : undefined

    // Special transform for Bool type
    if (title === "Bool") {
      const constructors = unionDef.anyOf.filter(
        (item): item is BlueprintTypes.ConstructorDefinitionType =>
          "dataType" in item && item.dataType === "constructor"
      )
      // Check if it's the standard True/False pattern
      if (
        constructors.length === 2 &&
        constructors.some((c) => c.title === "True") &&
        constructors.some((c) => c.title === "False")
      ) {
        return "TSchema.Boolean"
      }
    }

    // Handle Option<T> transformation based on optionStyle
    if (title === "Option" && config.optionStyle !== "Union") {
      // Extract inner type from Option<T> pattern (Some/None constructors)
      const constructors = unionDef.anyOf.filter(
        (item): item is BlueprintTypes.ConstructorDefinitionType =>
          "dataType" in item && item.dataType === "constructor"
      )

      const someConstructor = constructors.find((c) => c.title === "Some")
      if (someConstructor?.fields?.[0]) {
        let innerType: string
        const field = someConstructor.fields[0]

        if (field.$ref) {
          const refPath = field.$ref.replace("#/definitions/", "")
          const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
          const refIdentifier = resolveReference(refName, currentNamespace, config)
          // Only wrap in Schema.suspend if config allows and it's not a primitive
          const isPrimitive = refIdentifier === "ByteArray" || refIdentifier === "Int" || refIdentifier === "PlutusData"
          innerType = isPrimitive || !config.useSuspend ? refIdentifier : `Schema.suspend(() => ${refIdentifier})`
        } else if (field.schema) {
          innerType = generateTSchema(field.schema, definitions, config, currentNamespace, indent)
        } else {
          innerType = "PlutusData"
        }

        // Generate the appropriate TSchema based on optionStyle
        const optionFn = config.optionStyle === "NullOr" ? "TSchema.NullOr" : "TSchema.UndefinedOr"
        return `${optionFn}(${innerType})`
      }
    }

    // Check if this is a Variant pattern (all members are named constructors)
    const isVariant = unionDef.anyOf.every((member) => {
      if ("dataType" in member && member.dataType === "constructor") {
        const constructorMember = member as BlueprintTypes.ConstructorDefinitionType
        // Must have fields array (title is optional for single-constructor Void pattern)
        return constructorMember.fields !== undefined
      }
      return false
    })

    if (isVariant) {
      // If only one variant, unwrap it to just a Struct or Void
      if (unionDef.anyOf.length === 1) {
        const constructorMember = unionDef.anyOf[0] as BlueprintTypes.ConstructorDefinitionType
        const fields = constructorMember.fields!

        // Special case: single constructor with no fields (Void/Unit pattern)
        if (fields.length === 0) {
          // Use constructor title, then definition key, then fallback to "Unit"
          const tag = constructorMember.title || definitionKey || "Unit"
          const indexOpt =
            constructorMember.index && constructorMember.index !== 0 ? `, { index: ${constructorMember.index} }` : ""
          return `TSchema.Literal("${tag}" as const${indexOpt})`
        }

        // Build the fields object
        const fieldSchemas: Array<string> = []
        for (let i = 0; i < fields.length; i++) {
          const field = fields[i]!
          const fieldName = field.title || (fields.length === 1 ? "value" : `field${i}`)

          let fieldSchema: string
          if (field.$ref) {
            const refPath = field.$ref.replace("#/definitions/", "")
            const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
            const refId = resolveReference(refName, currentNamespace, config)
            fieldSchema = config.useSuspend ? `Schema.suspend(() => ${refId})` : refId
          } else if (field.schema) {
            fieldSchema = generateTSchema(
              field.schema,
              definitions,
              config,
              currentNamespace,
              indent + config.indent + config.indent
            )
          } else {
            fieldSchema = "PlutusData"
          }

          fieldSchemas.push(`${indent}${config.indent}${config.indent}${fieldName}: ${fieldSchema}`)
        }

        return `TSchema.Struct({\n${fieldSchemas.join(",\n")}\n${indent}${config.indent}})`
      }

      // Check if all variants have at least one named field
      const allHaveNamedFields = unionDef.anyOf.every((member) => {
        const constructorMember = member as BlueprintTypes.ConstructorDefinitionType
        return constructorMember.fields?.some((f) => f.title)
      })

      // Get the type title for custom field name lookup
      const typeTitle = "title" in def ? (def as { title?: string }).title : undefined

      // Check if any constructor has empty fields and emptyConstructorStyle is "Literal"
      const hasEmptyConstructors = unionDef.anyOf.some((member) => {
        const constructorMember = member as BlueprintTypes.ConstructorDefinitionType
        return constructorMember.fields?.length === 0
      })

      // Use Union with mixed Struct/Literal if there are empty constructors and Literal style is preferred
      const useUnionWithLiterals = hasEmptyConstructors && config.emptyConstructorStyle === "Literal"

      // Use Variant if fields are named OR if forceVariant is enabled (and not using Union with Literals)
      if ((allHaveNamedFields || config.forceVariant) && !useUnionWithLiterals) {
        // Generate Variant with named tags and fields
        const variantFields: Array<string> = []
        for (const member of unionDef.anyOf) {
          const constructorMember = member as BlueprintTypes.ConstructorDefinitionType
          const tag = constructorMember.title!
          const fields = constructorMember.fields!

          // Build the fields object
          const fieldSchemas: Array<string> = []
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i]!

            // Determine field name
            let fieldName: string
            if (field.title) {
              // Use explicit field name from Blueprint
              fieldName = field.title
            } else {
              // Try custom field names from config
              const lookupKey = typeTitle ? `${typeTitle}.${tag}` : tag
              const customFieldNames = config.variantFieldNames?.[lookupKey]
              if (customFieldNames && customFieldNames[i]) {
                fieldName = customFieldNames[i]!
              } else {
                // Fall back to configured naming pattern
                fieldName =
                  fields.length === 1
                    ? config.fieldNaming.singleFieldName
                    : config.fieldNaming.multiFieldPattern.replace("{index}", i.toString())
              }
            }

            let fieldSchema: string
            if (field.$ref) {
              const refPath = field.$ref.replace("#/definitions/", "")
              const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
              const refId = resolveReference(refName, currentNamespace, config)
              fieldSchema = config.useSuspend ? `Schema.suspend(() => ${refId})` : refId
            } else if (field.schema) {
              fieldSchema = generateTSchema(
                field.schema,
                definitions,
                config,
                currentNamespace,
                indent + config.indent + config.indent + config.indent
              )
            } else {
              fieldSchema = "PlutusData"
            }

            fieldSchemas.push(`${fieldName}: ${fieldSchema}`)
          }

          variantFields.push(
            `${indent}${config.indent}${config.indent}${tag}: {\n${fieldSchemas.map((f) => `${indent}${config.indent}${config.indent}${config.indent}${f}`).join(",\n")}\n${indent}${config.indent}${config.indent}}`
          )
        }

        return `TSchema.Variant({\n${variantFields.join(",\n")}\n${indent}${config.indent}})`
      } else if (useUnionWithLiterals) {
        // Generate Union with mixed TSchema.Struct and TSchema.Literal for empty constructors
        const unionMembers: Array<string> = []
        for (let memberIndex = 0; memberIndex < unionDef.anyOf.length; memberIndex++) {
          const member = unionDef.anyOf[memberIndex]!
          const constructorMember = member as BlueprintTypes.ConstructorDefinitionType
          const tag = constructorMember.title!
          const fields = constructorMember.fields!

          // All constructors use TSchema.TaggedStruct (with _tag field)
          const fieldSchemas: Array<string> = []
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i]!

            // Determine field name
            let fieldName: string
            if (field.title) {
              fieldName = field.title
            } else {
              const lookupKey = typeTitle ? `${typeTitle}.${tag}` : tag
              const customFieldNames = config.variantFieldNames?.[lookupKey]
              if (customFieldNames && customFieldNames[i]) {
                fieldName = customFieldNames[i]!
              } else {
                // Use constructor tag name for single field instead of "value"
                fieldName =
                  fields.length === 1
                    ? tag.charAt(0).toLowerCase() + tag.slice(1)
                    : config.fieldNaming.multiFieldPattern.replace("{index}", i.toString())
              }
            }

            let fieldSchema: string
            if (field.$ref) {
              const refPath = field.$ref.replace("#/definitions/", "")
              const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
              const refId = resolveReference(refName, currentNamespace, config)
              fieldSchema = config.useSuspend ? `Schema.suspend(() => ${refId})` : refId
            } else if (field.schema) {
              fieldSchema = generateTSchema(
                field.schema,
                definitions,
                config,
                currentNamespace,
                indent + config.indent + config.indent
              )
            } else {
              fieldSchema = "PlutusData"
            }

            fieldSchemas.push(`${indent}${config.indent}${config.indent}${config.indent}${fieldName}: ${fieldSchema}`)
          }

          // TaggedStruct for all constructors (empty or not)
          const fieldsStr = fieldSchemas.length > 0 ? `{ ${fieldSchemas.join(", ")} }` : "{}"
          unionMembers.push(
            `${indent}${config.indent}TSchema.TaggedStruct("${tag}", ${fieldsStr}, { flatInUnion: true })`
          )
        }

        return `TSchema.Union(\n${unionMembers.join(",\n")}\n${indent})`
      } else {
        // Generate Union of TaggedStructs for unnamed fields
        const taggedStructs: Array<string> = []
        for (const member of unionDef.anyOf) {
          const constructorMember = member as BlueprintTypes.ConstructorDefinitionType
          const tag = constructorMember.title!
          const fields = constructorMember.fields!

          // Build the fields object
          const fieldSchemas: Array<string> = []
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i]!
            const fieldName = field.title || (fields.length === 1 ? "value" : `field${i}`)

            let fieldSchema: string
            if (field.$ref) {
              const refPath = field.$ref.replace("#/definitions/", "")
              const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
              const refId = resolveReference(refName, currentNamespace, config)
              fieldSchema = config.useSuspend ? `Schema.suspend(() => ${refId})` : refId
            } else if (field.schema) {
              fieldSchema = generateTSchema(
                field.schema,
                definitions,
                config,
                currentNamespace,
                indent + config.indent + config.indent
              )
            } else {
              fieldSchema = "PlutusData"
            }

            fieldSchemas.push(`${indent}${config.indent}${config.indent}${fieldName}: ${fieldSchema}`)
          }

          taggedStructs.push(
            `${indent}  TSchema.TaggedStruct("${tag}", {\n${fieldSchemas.join(",\n")}\n${indent}  }, { flatFields: true })`
          )
        }

        return `TSchema.Union(\n${taggedStructs.join(",\n")}\n${indent})`
      }
    }

    // Otherwise use regular Union
    const members = def.anyOf.map((memberDef) =>
      generateTSchema(memberDef, definitions, config, currentNamespace, indent)
    )
    return `TSchema.Union(\n${indent}  ${members.join(`,\n${indent}  `)}\n${indent})`
  }

  // Handle empty schema
  if (Object.keys(def).length === 0) {
    return "PlutusData"
  }

  return "PlutusData"
}

/**
 * Extract dependencies from a schema definition
 */
function extractDependencies(
  def: BlueprintTypes.SchemaDefinitionType,
  _definitions: Record<string, BlueprintTypes.SchemaDefinitionType>
): Set<string> {
  const deps = new Set<string>()

  function visit(node: BlueprintTypes.SchemaDefinitionType): void {
    if ("$ref" in node && node.$ref) {
      const refPath = node.$ref.replace("#/definitions/", "")
      const refName = refPath.replace(/~1/g, "/").replace(/~0/g, "~")
      if (refName !== "Data") {
        deps.add(refName)
      }
    }

    if ("dataType" in node) {
      if (node.dataType === "list" && "items" in node && node.items) {
        visit(node.items as BlueprintTypes.SchemaDefinitionType)
      }
      if (node.dataType === "map" && "keys" in node && node.keys && "values" in node && node.values) {
        visit(node.keys as BlueprintTypes.SchemaDefinitionType)
        visit(node.values as BlueprintTypes.SchemaDefinitionType)
      }
      if (node.dataType === "constructor" && "fields" in node && node.fields) {
        for (const field of node.fields) {
          if ("$ref" in field && field.$ref) {
            visit(field as BlueprintTypes.SchemaDefinitionType)
          }
          if ("schema" in field && field.schema) {
            visit(field.schema)
          }
        }
      }
    }

    if ("anyOf" in node && node.anyOf) {
      for (const member of node.anyOf) {
        visit(member)
      }
    }

    if ("fields" in node && Array.isArray(node.fields)) {
      for (const field of node.fields) {
        if ("$ref" in field && field.$ref) {
          visit(field as BlueprintTypes.SchemaDefinitionType)
        }
        if ("schema" in field && field.schema) {
          visit(field.schema)
        }
      }
    }
  }

  visit(def)
  return deps
}

/**
 * Topologically sort definitions to ensure dependencies come first
 */
function topologicalSort(
  definitions: Record<string, BlueprintTypes.SchemaDefinitionType>
): Array<[string, BlueprintTypes.SchemaDefinitionType]> {
  const sorted: Array<[string, BlueprintTypes.SchemaDefinitionType]> = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      // Circular dependency detected - skip to avoid infinite loop
      return
    }

    visiting.add(name)

    const def = definitions[name]
    if (def) {
      const deps = extractDependencies(def, definitions)
      for (const dep of deps) {
        if (definitions[dep]) {
          visit(dep)
        }
      }
      sorted.push([name, def])
    }

    visiting.delete(name)
    visited.add(name)
  }

  for (const name of Object.keys(definitions)) {
    visit(name)
  }

  return sorted
}

/**
 * Generate TypeScript code with TSchema from a Blueprint
 */
export function generateTypeScript(
  blueprint: BlueprintTypes.PlutusBlueprint,
  config: CodegenConfig = DEFAULT_CODEGEN_CONFIG
): string {
  const lines: Array<string> = []

  // File header
  lines.push("/**")
  lines.push(` * Generated from Blueprint: ${blueprint.preamble.title}`)
  lines.push(` * @generated - Do not edit manually`)
  lines.push(" */")
  lines.push("")
  if (config.imports.effect) {
    lines.push(config.imports.effect)
  }
  lines.push(config.imports.data)
  lines.push(config.imports.tschema)
  lines.push("")

  // Generate schema definitions
  lines.push("// ============================================================================")
  lines.push("// Schema Definitions")
  lines.push("// ============================================================================")
  lines.push("")
  lines.push("// PlutusData schema (referenced by Data type)")
  lines.push("export const PlutusData = TSchema.PlutusData")
  lines.push("")

  // Topologically sort definitions to ensure dependencies come first
  const sortedDefinitions = topologicalSort(blueprint.definitions)

  if (config.moduleStrategy === "namespaced") {
    // First, topologically sort ALL definitions globally
    const globallySortedDefs = sortedDefinitions

    // Separate primitives from namespaced types
    const primitives: Array<[string, BlueprintTypes.SchemaDefinitionType]> = []
    const namespacedTypes: Array<[string, BlueprintTypes.SchemaDefinitionType]> = []

    for (const [fullName, def] of globallySortedDefs) {
      const namespacePath = getNamespacePath(fullName)
      if (namespacePath === "") {
        primitives.push([fullName, def])
      } else {
        namespacedTypes.push([fullName, def])
      }
    }

    // Export primitives at root level
    for (const [fullName, def] of primitives) {
      // Skip Data - already defined as PlutusData
      if ("title" in def && def.title === "Data") {
        continue
      }

      // Use flattened name for primitives (handles $ and / characters)
      const primitiveName = getTypeName(fullName)

      const schemaDefinition = generateTSchema(def, blueprint.definitions, config, "", "", primitiveName)

      // Add JSDoc comment
      if ("title" in def && def.title) {
        lines.push("/**")
        lines.push(` * ${def.title}`)
        if ("description" in def && def.description) {
          lines.push(` * ${def.description}`)
        }
        lines.push(" */")
      }

      lines.push(`export const ${primitiveName} = ${schemaDefinition}`)
      lines.push("")
    }

    // Group namespaced types by namespace while preserving topological order
    const namespaceGroups = new Map<string, Array<[string, BlueprintTypes.SchemaDefinitionType]>>()
    for (const [fullName, def] of namespacedTypes) {
      const namespacePath = getNamespacePath(fullName)
      if (!namespaceGroups.has(namespacePath)) {
        namespaceGroups.set(namespacePath, [])
      }
      namespaceGroups.get(namespacePath)!.push([fullName, def])
    }

    // Track which namespaces have been opened/closed
    const openNamespaces: Array<string> = []
    let currentIndent = ""

    // Generate types in topological order, opening/closing namespaces as needed
    for (const [fullName, typeDef] of namespacedTypes) {
      const namespacePath = getNamespacePath(fullName)
      const nsLevels = namespacePath.split("/")
      const fullNsPath = nsLevels.join("/")

      // Check if we need to close any namespaces
      while (openNamespaces.length > 0 && !fullNsPath.startsWith(openNamespaces.join("/"))) {
        openNamespaces.pop()
        currentIndent = currentIndent.slice(0, -2)
        lines.push(`${currentIndent}}`)
        lines.push("")
      }

      // Check if we need to open any new namespaces
      for (let i = 0; i < nsLevels.length; i++) {
        const partialPath = nsLevels.slice(0, i + 1).join("/")
        if (!openNamespaces.join("/").startsWith(partialPath) || openNamespaces.length <= i) {
          const nsName = nsLevels[i].charAt(0).toUpperCase() + nsLevels[i].slice(1)
          lines.push(`${currentIndent}export namespace ${nsName} {`)
          currentIndent += "  "
          openNamespaces.push(nsLevels[i])
        }
      }

      // Generate the type
      const typeName = getTypeName(fullName)
      const schemaDefinition = generateTSchema(
        typeDef,
        blueprint.definitions,
        config,
        namespacePath, // current namespace for relative refs
        currentIndent,
        typeName
      )

      // Add JSDoc comment
      if ("title" in typeDef && typeDef.title) {
        lines.push(`${currentIndent}/**`)
        lines.push(`${currentIndent} * ${typeDef.title}`)
        if ("description" in typeDef && typeDef.description) {
          lines.push(`${currentIndent} * ${typeDef.description}`)
        }
        lines.push(`${currentIndent} */`)
      }

      lines.push(`${currentIndent}export const ${typeName} = ${schemaDefinition}`)
      lines.push("")
    }

    // Close any remaining open namespaces
    while (openNamespaces.length > 0) {
      openNamespaces.pop()
      currentIndent = currentIndent.slice(0, -2)
      lines.push(`${currentIndent}}`)
      lines.push("")
    }
  } else {
    // Flat mode (original behavior)
    for (const [name, def] of sortedDefinitions) {
      // Skip Data - already defined as PlutusData
      if ("title" in def && def.title === "Data") {
        continue
      }

      const schemaName = toIdentifier(name)
      const schemaDefinition = generateTSchema(def, blueprint.definitions, config, "", "", schemaName)

      // Add JSDoc comment
      if ("title" in def && def.title) {
        lines.push("/**")
        lines.push(` * ${def.title}`)
        if ("description" in def && def.description) {
          lines.push(` * ${def.description}`)
        }
        lines.push(" */")
      }

      lines.push(`export const ${schemaName} = ${schemaDefinition}`)
      lines.push("")
    }
  }

  // Generate validator contracts
  lines.push("// ============================================================================")
  lines.push("// Validators")
  lines.push("// ============================================================================")
  lines.push("")

  for (const validator of blueprint.validators) {
    const validatorName = toIdentifier(validator.title)

    lines.push("/**")
    lines.push(` * Validator: ${validator.title}`)
    lines.push(` * Hash: ${validator.hash}`)
    lines.push(" */")
    lines.push(`export const ${validatorName} = {`)
    lines.push(`  title: "${validator.title}",`)
    lines.push(`  hash: "${validator.hash}",`)
    lines.push(`  compiledCode: "${validator.compiledCode}",`)

    if (validator.datum) {
      const datumSchema = generateTSchema(validator.datum.schema, blueprint.definitions, config, "", "  ")
      if (datumSchema === "PlutusData") {
        lines.push(`  datum: ${datumSchema},`)
      } else {
        lines.push(`  datum: Data.withSchema(${datumSchema}),`)
      }
    }

    if (validator.redeemer) {
      const redeemerSchema =
        Object.keys(validator.redeemer.schema).length === 0
          ? "PlutusData"
          : generateTSchema(validator.redeemer.schema, blueprint.definitions, config, "", "  ")
      if (redeemerSchema === "PlutusData") {
        lines.push(`  redeemer: ${redeemerSchema},`)
      } else {
        lines.push(`  redeemer: Data.withSchema(${redeemerSchema}),`)
      }
    }

    if (validator.parameters && validator.parameters.length > 0) {
      lines.push("  parameters: [")
      for (const param of validator.parameters) {
        const paramSchema = generateTSchema(param.schema, blueprint.definitions, config, "", "    ")
        lines.push(`    ${paramSchema},`)
      }
      lines.push("  ],")
    }

    lines.push("} as const")
    lines.push("")
  }

  return lines.join("\n")
}
