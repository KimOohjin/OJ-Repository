import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { GeneratorWizard } from '@/ui/GeneratorWizard'
import { ProgramView } from '@/ui/ProgramView'
import { Card } from '@/ui/primitives'

type Tab = 'today' | 'program' | 'history' | 'analytics' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: '오늘', icon: '🏋️' },
  { id: 'program', label: '프로그램', icon: '📋' },
  { id: 'history', label: '기록', icon: '📅' },
  { id: 'analytics', label: '분석', icon: '📈' },
  { id: 'settings', label: '설정', icon: '⚙️' },
]

function Stub({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card className="text-slate-400 text-sm">이 화면은 곧 추가됩니다.</Card>
    </div>
  )
}

function ProgramScreen() {
  const activeProgram = useAppStore((s) => s.activeProgram)
  const [forceWizard, setForceWizard] = useState(false)

  if (!activeProgram || forceWizard) {
    return (
      <div className="space-y-4">
        {activeProgram && forceWizard && (
          <button
            type="button"
            className="text-sm text-slate-400 underline"
            onClick={() => setForceWizard(false)}
          >
            ← 현재 프로그램으로 돌아가기
          </button>
        )}
        <GeneratorWizard />
      </div>
    )
  }
  return <ProgramView loaded={activeProgram} onRegenerate={() => setForceWizard(true)} />
}

export default function App() {
  const ready = useAppStore((s) => s.ready)
  const init = useAppStore((s) => s.init)
  const [tab, setTab] = useState<Tab>('program')

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="min-h-full flex flex-col max-w-lg mx-auto">
      <main className="flex-1 px-4 pt-6 pb-28">
        {!ready ? (
          <p className="text-slate-400">불러오는 중…</p>
        ) : tab === 'today' ? (
          <Stub title="오늘" />
        ) : tab === 'program' ? (
          <ProgramScreen />
        ) : tab === 'history' ? (
          <Stub title="기록" />
        ) : tab === 'analytics' ? (
          <Stub title="분석" />
        ) : (
          <Stub title="설정" />
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 max-w-lg mx-auto bg-slate-900/95 backdrop-blur ring-1 ring-slate-800 flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-[11px] ${
              tab === t.id ? 'text-indigo-400' : 'text-slate-500'
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
