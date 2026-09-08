import { create } from 'zustand'
import { getAllSettings, type SettingsShape } from '@/data/db'
import {
  getCatalog,
  loadActiveProgram,
  saveProgramDraft,
  seedCatalog,
  type LoadedProgram,
} from '@/data/seed'
import { generateProgram } from '@/domain/generator/programGenerator'
import type { Exercise, GeneratorInput } from '@/domain/types'

interface AppState {
  ready: boolean
  catalog: Exercise[]
  exercisesById: Map<string, Exercise>
  activeProgram: LoadedProgram | null
  settings: SettingsShape

  init: () => Promise<void>
  refreshProgram: () => Promise<void>
  generateFromRules: (input: GeneratorInput) => Promise<void>
  reloadSettings: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  catalog: [],
  exercisesById: new Map(),
  activeProgram: null,
  settings: {} as SettingsShape,

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
  },

  refreshProgram: async () => {
    set({ activeProgram: await loadActiveProgram() })
  },

  generateFromRules: async (input) => {
    const draft = generateProgram(input, get().catalog)
    await saveProgramDraft(draft)
    await get().refreshProgram()
  },

  reloadSettings: async () => {
    set({ settings: await getAllSettings() })
  },
}))
