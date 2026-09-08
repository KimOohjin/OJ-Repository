import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * The service worker is registered with `registerType: 'prompt'` — we never
 * auto-skipWaiting, because activating a new worker mid-session can tear down
 * in-flight IndexedDB transactions (i.e. lose a set you just logged).
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="fixed top-3 inset-x-0 max-w-lg mx-auto px-4 z-40">
      <div className="rounded-xl bg-slate-800 ring-1 ring-slate-600 px-4 py-3 flex items-center gap-3">
        <span className="text-sm flex-1">새 버전이 있어요.</span>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="text-sm text-slate-400"
        >
          나중에
        </button>
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="min-h-10 px-3 rounded-lg bg-indigo-500 text-sm font-semibold"
        >
          새로고침
        </button>
      </div>
    </div>
  )
}
