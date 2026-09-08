import { create } from 'zustand'
import { getAllSettings, setSetting, type SettingsShape, type WorkoutRecord } from '@/data/db'
import {
  getCatalog,
  loadActiveProgram,
  saveProgramDraft,
  seedCatalog,
  type LoadedProgram,
} from '@/data/seed'
import { currentAcwr, evaluateDeloadNow, getActiveWorkout, todaysReadiness } from '@/data/sessions'
import { generateProgram } from '@/domain/generator/programGenerator'
import { generateWithAi, PROVIDERS, type AiProvider } from '@/domain/generator/aiGenerator'
import type { Exercise, GeneratorInput } from '@/domain/types'
import type { AcwrResult, DeloadRecommendation } from '@/domain/readiness/fatigueModel'
import type { ReadinessEntryRecord } from '@/data/db'

interface AppState {
  ready: boolean
  catalog: Exercise[]
  exercisesById: Map<string, Exercise>
  activeProgram: LoadedProgram | null
  settings: SettingsShape
  activeWorkout: WorkoutRecord | null
  readinessToday: ReadinessEntryRecord | null
  acwr: AcwrResult | null
  deload: DeloadRecommendation | null

  init: () => Promise<void>
  refreshProgram: () => Promise<void>
  refreshStatus: () => Promise<void>
  generateFromRules: (input: GeneratorInput) => Promise<void>
  generateFromAi: (input: GeneratorInput) => Promise<{ fellBack: boolean; error?: string }>
  updateSetting: <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  catalog: [],
  exercisesById: new Map(),
  activeProgram: null,
  settings: {} as SettingsShape,
  activeWorkout: null,
  readinessToday: null,
  acwr: null,
  deload: null,

  init: async () => {
    await seedCatalog()
    const [catalog, activeProgram, settings] = await Promise.all([
      getCatalog(),
      loadActiveProgram(),
      getAllSettings(),
    ])
    set({
      ready: true,
      catalog,
      exercisesById: new Map(catalog.map((e) => [e.id, e])),
      activeProgram,
      settings,
    })
    await get().refreshStatus()
  },

  refreshProgram: async () => {
    set({ activeProgram: await loadActiveProgram() })
    await get().refreshStatus()
  },

  refreshStatus: async () => {
    const program = get().activeProgram
    const [activeWorkout, readinessToday, acwr] = await Promise.all([
      getActiveWorkout(),
      todaysReadiness(),
      currentAcwr(),
    ])
    let deload: DeloadRecommendation | null = null
    if (program?.block) {
      deload = await evaluateDeloadNow({
        currentWeek: program.block.currentWeek,
        blockLengthWeeks: program.block.lengthWeeks,
        accumulationWeeks: program.block.accumulationWeeks,
      })
    }
    set({
      activeWorkout: activeWorkout ?? null,
      readinessToday: readinessToday ?? null,
      acwr,
      deload,
    })
  },

  generateFromRules: async (input) => {
    const draft = generateProgram(input, get().catalog)
    await saveProgramDraft(draft)
    await get().refreshProgram()
  },

  generateFromAi: async (input) => {
    const { settings, catalog } = get()
    const provider = PROVIDERS[(settings.aiProvider ?? 'gemini') as AiProvider]
    const result = await generateWithAi(input, catalog, provider, settings.aiApiKey)
    await saveProgramDraft(result.draft)
    await get().refreshProgram()
    return { fellBack: result.fellBack, error: result.error }
  },

  updateSetting: async (key, value) => {
    await setSetting(key, value)
    set({ settings: { ...get().settings, [key]: value } })
  },
}))
