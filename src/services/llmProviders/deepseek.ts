import type OpenAI from 'openai'
import { getDeepSeekClient } from '../apiClients'
import { useSettingsStore } from '../../stores/settingsStore'
import { createProviderModel, listModelsViaMainProcess } from './modelDiscovery'
import { createOpenAICompatibleResponse } from './openAICompatible'
import { DEEPSEEK_OPENAI_BASE_URL, DEEPSEEK_MODELS } from './providerCatalog'

function createDeepSeekModel(id: string): OpenAI.Models.Model {
  return createProviderModel(id, 'deepseek')
}

function listStaticDeepSeekTextModels(): OpenAI.Models.Model[] {
  return DEEPSEEK_MODELS.map(model => createDeepSeekModel(model.id))
}

function isAuthError(error: any): boolean {
  return error?.status === 401 || error?.status === 403
}

function filterDeepSeekSupportedModels(
  models: OpenAI.Models.Model[]
): OpenAI.Models.Model[] {
  const textModelIds = new Set(DEEPSEEK_MODELS.map(model => model.id))
  return models
    .filter(model => textModelIds.has(model.id))
    .sort((a, b) => {
      const visionModel = 'deepseek-v4-flash-vision-exp'
      if (a.id === visionModel) return -1
      if (b.id === visionModel) return 1
      return a.id.localeCompare(b.id)
    })
}

export async function listDeepSeekModelsForConfig(
  apiKey: string,
  baseURL = DEEPSEEK_OPENAI_BASE_URL
): Promise<OpenAI.Models.Model[]> {
  try {
    const models = await listModelsViaMainProcess({
      apiKey,
      baseURL,
      providerName: 'DeepSeek',
    })
    const supportedModels = filterDeepSeekSupportedModels(models)
    return supportedModels.length > 0
      ? supportedModels
      : listStaticDeepSeekTextModels()
  } catch (error) {
    if (isAuthError(error)) {
      throw error
    }
    return listStaticDeepSeekTextModels()
  }
}

export const listDeepSeekModels = async (): Promise<OpenAI.Models.Model[]> => {
  const settings = useSettingsStore().config
  return listDeepSeekModelsForConfig(
    settings.VITE_DEEPSEEK_API_KEY || '',
    settings.deepseekBaseUrl || DEEPSEEK_OPENAI_BASE_URL
  )
}

export const createDeepSeekResponse = async (
  input: OpenAI.Responses.Request.InputItemLike[],
  _previousResponseId: string | null,
  stream: boolean = false,
  customInstructions?: string,
  signal?: AbortSignal
): Promise<any> => {
  return createOpenAICompatibleResponse(
    'deepseek',
    getDeepSeekClient,
    input,
    stream,
    customInstructions,
    signal
  )
}
