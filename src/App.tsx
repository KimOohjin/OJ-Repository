import { lazy, Suspense, useEffect, useState } from 'react'
import type { WorkoutRecord } from '@/data/db'
import { requestPersistentStorage, shouldNudgeBackup } from '@/platform/storage'
import { useAppStore } from '@/store/useAppStore'
import { GeneratorWizard } from '@/ui/GeneratorWizard'
import { HistoryScreen } from '@/ui/HistoryScreen'
import { ProgramView } from '@/ui/ProgramView'
import { SessionScreen } from '@/ui/SessionScreen'
import { SettingsScreen } from '@/ui/SettingsScreen'
import { TodayScreen } from '@/ui/TodayScreen'
import { UpdatePrompt } from '@/ui/UpdatePrompt'
import { Card } from '@/ui/primitives'

// Charts pull in Recharts (~500kB) — keep it out of the initial load so the
// gym-critical screens stay fast on mobile data.
const AnalyticsScreen = lazy(() =>
  import('@/ui/AnalyticsScreen').then((m) => ({ default: m.AnalyticsScreen })),
)

type Tab = 'today' | 'program' | 'history' | 'analytics' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'today', label: '오늘', icon: '🏋️' },
  { id: 'program', label: '프로그램', icon: '📋' },
  { id: 'history', label: '기록', icon: '📅' },
  { id: 'analytics', label: '분석', icon: '📈' },
  { id: 'settings', label: '설정', icon: '⚙️' },
]

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
  const activeWorkout = useAppStore((s) => s.activeWorkout)
  const [tab, setTab] = useState<Tab>('today')
  const [session, setSession] = useState<WorkoutRecord | null>(null)
  const [nudgeBackup, setNudge] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // Resume an interrupted session (app closed mid-workout).
  useEffect(() => {
    if (activeWorkout && !session) setSession(activeWorkout)
  }, [activeWorkout, session])

  useEffect(() => {
    if (ready) void shouldNudgeBackup().then(setNudge)
  }, [ready, session])

  // Ask for persistent storage after the first real interaction.
  useEffect(() => {
    if (!ready) return
    const once = () => {
      void requestPersistentStorage()
      window.removeEventListener('pointerdown', once)
    }
    window.addEventListener('pointerdown', once, { once: true })
    return () => window.removeEventListener('pointerdown', once)
  }, [ready])

  if (session) {
    return (
      <div className="min-h-full flex flex-col max-w-lg mx-auto">
        <UpdatePrompt />
        <main className="flex-1 px-4 pt-6 pb-28">
          <SessionScreen workout={session} onExit={() => setSession(null)} />
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col max-w-lg mx-auto">
      <UpdatePrompt />
      <main className="flex-1 px-4 pt-6 pb-28 space-y-4">
        {!ready ? (
          <p className="text-slate-400">불러오는 중…</p>
        ) : (
          <>
            {nudgeBackup && tab !== 'settings' && (
              <Card className="ring-amber-500/40 bg-amber-500/10 text-sm text-amber-200">
                백업한 지 오래됐어요. <b>설정 → 백업 내보내기</b>로 데이터를 저장해 두세요.
              </Card>
            )}
            {tab === 'today' && <TodayScreen onStarted={setSession} />}
            {tab === 'program' && <ProgramScreen />}
            {tab === 'history' && <HistoryScreen />}
            {tab === 'analytics' && (
              <Suspense fallback={<p className="text-slate-400">차트 불러오는 중…</p>}>
                <AnalyticsScreen />
              </Suspense>
            )}
            {tab === 'settings' && <SettingsScreen />}
          </>
        )}
      </main>

      <nav className="safe-bottom fixed bottom-0 inset-x-0 max-w-lg mx-auto bg-slate-900/95 backdrop-blur ring-1 ring-slate-800 flex">
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
