# 나만의 운동 앱

혼자 훈련하는 사람을 위한 **코치 앱**. 기록만 하는 앱이 아니라, 프로그램을 만들어 주고
증량을 제안하고 피로도를 봐준다.

해결하려는 문제 세 가지:

1. 기록이 번거로워 **점진적 과부하**를 이어가기 어렵다 → 직전 값 자동 채움 + 큰 버튼 + 자동 휴식 타이머
2. 루틴이 일관되지 않아 **주기화**가 어렵다 → 목표만 입력하면 4주 메소사이클을 자동 생성
3. **피로도를 관리해줄 사람**이 없다 → 컨디션 체크 · 훈련 부하(ACWR) · 디로드 자동 추천

## 설치 (아이폰)

Safari로 배포 주소를 열고 **공유 → 홈 화면에 추가**.

> 홈 화면에 추가하지 않고 Safari 탭에서만 쓰면 iOS가 **7일 뒤 데이터를 지울 수 있다.**
> 설치해도 정기적으로 `설정 → 백업 내보내기`로 JSON을 저장해 두는 게 안전하다.

데이터는 **전부 이 기기에만** 저장된다. 서버도, 계정도, 운영비도 없다.

## 개발

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 도메인 로직 유닛 테스트
npm run smoke    # 실제 브라우저 E2E (dev 서버가 떠 있어야 함)
npm run build
npm run icons    # PWA 아이콘 재생성
npm run preview:program            # 생성 결과를 터미널에 출력 (주간 세트 합계 포함)
npm run preview:program 90 4 strength   # 분/일수/목표 지정
```

## 배포 (GitHub Pages, 무료)

**현재 배포 주소:** https://kimoohjin.github.io/OJ-Repository/

두 가지 방법 중 하나. 현재는 **A**로 배포돼 있다.

### A. 수동 (CI 불필요)

```bash
npm run deploy
```

`dist/`를 저장소 이름에 맞는 base로 빌드해 `gh-pages` 브랜치로 force-push 한다.
`gh-pages` 브랜치가 곧 배포본이므로 소스는 `main`에 따로 push하면 된다.
Pages 설정: Settings → Pages → Source = **Deploy from a branch**, `gh-pages` / `/ (root)`.

### B. GitHub Actions (자동)

`main`에 push할 때마다 `.github/workflows/deploy.yml`이 빌드·배포한다.
이 워크플로 파일을 push하려면 토큰에 `workflow` 권한이 필요하다:

```bash
gh auth refresh -s workflow      # 1회
git push origin main
```

그다음 Settings → Pages → Source를 **GitHub Actions**로 바꾼다. A와 B는 병행하지 않는다.

## 구조

```
src/
  domain/                 UI와 분리된 순수 로직 (테스트 대상)
    types.ts              공통 타입, 근육/장비 열거형
    generator/
      data.ts             방법론 상수 — 볼륨 랜드마크, 렙/RPE/휴식, 분할표, 시간 예산
      exerciseSelection.ts 슬롯별 종목 스코어링
      programGenerator.ts  규칙 엔진 파이프라인
      aiGenerator.ts       AI 생성(BYO 키) + 스키마 검증 + 규칙 엔진 폴백
    progression/
      e1rm.ts             e1RM 공식, RPE→%1RM 표
      progressionEngine.ts 더블/선형 프로그레션, 정체 감지, 블록 시딩
    readiness/
      fatigueModel.ts     레디니스 점수, sRPE·ATL·CTL·ACWR, 볼륨 신호등, 디로드 트리거
  data/                   Dexie(IndexedDB) 스키마 + 저장/조회
  platform/               Wake Lock, 휴식 타이머, 저장소 보호
  ui/                     화면
```

도메인 계층은 순수 함수라, 계수(볼륨표·RPE 표·ACWR 임계 등)를 파이썬 노트북에서
실제 기록으로 튜닝한 뒤 `domain/`의 상수 테이블만 갈아끼울 수 있다.

## 프로그램 생성 방식

**규칙 엔진 (기본, 무료·오프라인)** — 주당 일수·목표·세션 길이·경력·우선 부위·제외 장비를
받아 분할을 고르고, 슬롯마다 카탈로그에서 종목을 스코어링해 뽑고, 세션 시간 예산에 맞춰
종목/세트를 조절하고, 근육군별 주간 볼륨을 MEV~MRV 범위로 맞춘다. 4주 = 축적 3주 + 디로드 1주.

**AI 생성 (선택)** — `설정`에서 본인 API 키를 넣으면 자유 서술("어깨가 안 좋아 오버헤드
프레스는 빼줘")로 생성할 수 있다. 호출은 기기에서 제공자로 직접 가고 각자 자기 쿼터를 쓴다.
Gemini는 무료 티어가 있어 카드 등록 없이 쓸 수 있다. 결과는 규칙 엔진의 기준으로 검증되고
실패하면 자동으로 규칙 엔진이 대신 만든다. **API 키는 백업 JSON에 포함되지 않는다.**

## iOS 제약과 대응

| 제약 | 대응 |
|---|---|
| 미설치 PWA는 7일 후 저장소 삭제 | 설치 안내 배너, `storage.persist()` 요청, 백업 넛지, 앱 내 스냅샷 3개 보관 |
| 백그라운드 알림 불가 (푸시 서버 없음) | 휴식 타이머를 절대 시각(`endsAt`)으로 저장 → 복귀 시 재계산. 화면이 켜져 있으면 소리로 알림 |
| 화면 꺼짐 | Wake Lock (iOS 16.4+), 복귀 시 자동 재획득 |
| 서비스워커 업데이트 | 자동 적용 안 함 — "새로고침" 프롬프트 (기록 중 트랜잭션 유실 방지) |
