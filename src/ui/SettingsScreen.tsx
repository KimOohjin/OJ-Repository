import { useEffect, useRef, useState } from 'react'
import { exportBackup, importBackup, inspectBackup, type ImportSummary } from '@/data/backup'
import { PROVIDERS, type AiProvider } from '@/domain/generator/aiGenerator'
import {
  formatBytes,
  getStorageInfo,
  isIos,
  isStandalone,
  requestPersistentStorage,
  type StorageEstimateInfo,
} from '@/platform/storage'
import { isWakeLockSupported } from '@/platform/wakeLock'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card, Field, SegmentedControl } from './primitives'

export function SettingsScreen() {
  const settings = useAppStore((s) => s.settings)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const init = useAppStore((s) => s.init)

  const [storage, setStorage] = useState<StorageEstimateInfo | null>(null)
  const [apiKey, setApiKey] = useState(settings.aiApiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [pending, setPending] = useState<{ json: string; summary: ImportSummary } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getStorageInfo().then(setStorage)
  }, [])

  useEffect(() => {
    setApiKey(settings.aiApiKey ?? '')
  }, [settings.aiApiKey])

  const provider = PROVIDERS[(settings.aiProvider ?? 'gemini') as AiProvider]
  const installed = isStandalone()

  const onPickFile = async (file: File) => {
    try {
      const json = await file.text()
      setPending({ json, summary: inspectBackup(json) })
      setMessage(null)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '파일을 읽을 수 없습니다.')
    }
  }

  const doImport = async (mode: 'merge' | 'replace') => {
    if (!pending) return
    try {
      await importBackup(pending.json, mode)
      setPending(null)
      setMessage('가져오기 완료 — 데이터를 다시 불러왔습니다.')
      await init()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '가져오기에 실패했습니다.')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">설정</h1>

      {isIos() && !installed && (
        <Card className="ring-amber-500/50 bg-amber-500/10 space-y-1.5 text-sm">
          <p className="font-semibold text-amber-300">홈 화면에 추가해 주세요</p>
          <p className="text-amber-100/90">
            Safari 탭에서 실행 중이면 iOS가 <b>7일 후 데이터를 삭제</b>할 수 있어요. 공유 버튼 →
            &ldquo;홈 화면에 추가&rdquo;로 설치하면 이 제한에서 벗어납니다.
          </p>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="font-semibold">데이터 백업</h2>
        <p className="text-xs text-slate-400">
          이 앱은 데이터를 서버가 아닌 이 기기에만 저장합니다. 정기적으로 내보내 두세요.
          {settings.lastBackupAt
            ? ` (마지막 백업: ${new Date(settings.lastBackupAt).toLocaleDateString()})`
            : ' (아직 백업한 적 없음)'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportBackup()}>백업 내보내기</Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            백업 가져오기
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onPickFile(f)
            e.target.value = ''
          }}
        />
        {pending && (
          <div className="rounded-xl bg-slate-900 ring-1 ring-slate-700 p-3 space-y-2">
            <p className="text-sm font-medium">가져올 데이터</p>
            <ul className="text-xs text-slate-400 grid grid-cols-2 gap-x-3">
              {Object.entries(pending.summary.counts)
                .filter(([, n]) => n > 0)
                .map(([name, n]) => (
                  <li key={name}>
                    {name}: {n}
                  </li>
                ))}
            </ul>
            <div className="flex gap-2 flex-wrap">
              <Button variant="ghost" onClick={() => void doImport('merge')}>
                병합
              </Button>
              <Button variant="danger" onClick={() => void doImport('replace')}>
                전체 교체
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)}>
                취소
              </Button>
            </div>
          </div>
        )}
        {message && <p className="text-sm text-indigo-300">{message}</p>}
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold">저장소 상태</h2>
        {storage ? (
          <>
            <p className="text-sm text-slate-300">
              사용 {formatBytes(storage.usageBytes)} / 할당 {formatBytes(storage.quotaBytes)}
            </p>
            <p className={`text-sm ${storage.persisted ? 'text-emerald-400' : 'text-amber-400'}`}>
              {storage.persisted
                ? '영구 저장소 보호가 켜져 있습니다.'
                : '영구 저장소 보호가 꺼져 있습니다 — 백업을 자주 해주세요.'}
            </p>
            {!storage.persisted && (
              <Button
                variant="ghost"
                onClick={async () => {
                  const ok = await requestPersistentStorage()
                  setStorage(await getStorageInfo())
                  setMessage(ok ? '영구 저장소가 허용되었습니다.' : '브라우저가 거부했습니다.')
                }}
              >
                영구 저장소 요청
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-400">이 브라우저는 저장소 정보를 제공하지 않습니다.</p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">AI 프로그램 생성 (선택)</h2>
        <p className="text-xs text-slate-400">
          키는 <b>이 기기에만</b> 저장되고 {provider.label}로만 전송됩니다. 백업 파일에는 포함되지
          않습니다.
        </p>
        <Field label="제공자">
          <SegmentedControl
            value={settings.aiProvider ?? 'gemini'}
            onChange={(v) => void updateSetting('aiProvider', v as AiProvider)}
            options={[
              { value: 'gemini', label: 'Gemini (무료)' },
              { value: 'anthropic', label: 'Claude (유료)' },
              { value: 'openai', label: 'OpenAI (유료)' },
            ]}
          />
        </Field>
        <div>
          <label htmlFor="ai-key" className="block mb-2 text-sm font-medium text-slate-400">
            API 키
          </label>
          <div className="flex gap-2">
            <input
              id="ai-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="키 붙여넣기"
              className="flex-1 min-h-12 px-3 rounded-xl bg-slate-900 ring-1 ring-slate-700 text-slate-100 text-sm"
            />
            <Button variant="ghost" onClick={() => setShowKey((v) => !v)}>
              {showKey ? '숨김' : '보기'}
            </Button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={async () => {
              await updateSetting('aiApiKey', apiKey.trim())
              setMessage(apiKey.trim() ? 'API 키를 저장했습니다.' : 'API 키를 삭제했습니다.')
            }}
          >
            키 저장
          </Button>
          <a
            href={provider.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="min-h-12 px-4 rounded-xl bg-slate-700 text-slate-100 font-semibold inline-flex items-center"
          >
            키 발급받기
          </a>
        </div>
        <p className="text-xs text-slate-500">
          {provider.free
            ? 'Gemini는 무료 티어가 있어 카드 등록 없이 사용할 수 있습니다 (분당·일당 요청 제한).'
            : '유료 종량제입니다 — 생성 1회당 소액이 과금됩니다.'}
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">운동 중</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            화면 켜짐 유지
            {!isWakeLockSupported() && (
              <span className="block text-xs text-slate-500">
                이 브라우저는 지원하지 않아요 (iOS 16.4+ 필요)
              </span>
            )}
          </span>
          <input
            type="checkbox"
            checked={settings.wakeLockEnabled ?? true}
            onChange={(e) => void updateSetting('wakeLockEnabled', e.target.checked)}
            className="w-6 h-6 accent-indigo-500"
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            휴식 종료 소리
            <span className="block text-xs text-slate-500">
              앱 화면이 켜져 있을 때만 울립니다 (iOS 제약)
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.restTimerSound ?? true}
            onChange={(e) => void updateSetting('restTimerSound', e.target.checked)}
            className="w-6 h-6 accent-indigo-500"
          />
        </label>
        <Field label="최소 증량 단위 (kg)">
          <SegmentedControl
            value={settings.minPlateIncrementKg ?? 2.5}
            onChange={(v) => void updateSetting('minPlateIncrementKg', v as number)}
            options={[
              { value: 1, label: '1kg' },
              { value: 2.5, label: '2.5kg' },
              { value: 5, label: '5kg' },
            ]}
          />
        </Field>
      </Card>
    </div>
  )
}
