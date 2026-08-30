import rawFunctionSchemasFromFile from '../../docs/functions.json'

export interface ApiRequestBodyFunctionTool {
  type: 'function'
  name: string
  strict: boolean
  description?: string
  parameters: Record<string, any>
}

export const PREDEFINED_OPENAI_TOOLS: ApiRequestBodyFunctionTool[] = (
  rawFunctionSchemasFromFile as any[]
).map(schema => {
  if (
    schema.parameters &&
    schema.parameters.type === 'object' &&
    schema.parameters.additionalProperties === undefined
  ) {
    schema.parameters.additionalProperties = false
  }
  return {
    type: 'function',
    name: schema.name,
    description: schema.description,
    parameters: schema.parameters,
    strict: schema.strict ?? false,
  }
})

/**
 * Checks the renderer-side tool policy at the point where a tool is about to
 * execute.  Building the request schema filters disabled tools for normal
 * model calls, but a response can arrive after settings changed (or come from
 * a provider that ignores the advertised schema).  Keeping this check next
 * to the canonical tool list lets the execution path fail closed without
 * affecting custom tools, which have their own enabled/valid policy.
 *
 * A missing `assistantTools` field is treated as legacy configuration and is
 * allowed.  An explicitly present but malformed value is denied for known
 * predefined tools, so a corrupt settings file cannot silently re-enable
 * desktop, filesystem, calendar, or messaging actions.
 */
export function isAssistantToolEnabled(
  toolName: string,
  settings: { assistantTools?: unknown } | null | undefined
): boolean {
  if (!PREDEFINED_OPENAI_TOOLS.some(tool => tool.name === toolName)) {
    return true
  }

  if (
    !settings ||
    !Object.prototype.hasOwnProperty.call(settings, 'assistantTools')
  ) {
    return true
  }

  const configuredTools = settings.assistantTools
  return (
    Array.isArray(configuredTools) &&
    configuredTools.some(
      configuredName =>
        typeof configuredName === 'string' && configuredName === toolName
    )
  )
}
