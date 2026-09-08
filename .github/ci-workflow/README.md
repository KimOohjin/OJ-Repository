# 자동 배포 워크플로 (대기 중)

`deploy.yml`은 원래 `.github/workflows/deploy.yml`에 있어야 하는 GitHub Actions
워크플로다. 이 저장소를 만든 토큰에 `workflow` 권한이 없어서 여기에 보관해 뒀다.

현재 배포는 `npm run deploy`(→ `gh-pages` 브랜치)로 이뤄지고 있고, 그것만으로도
문제없이 동작한다. 아래는 **자동 배포로 바꾸고 싶을 때만** 하면 된다.

```bash
gh auth refresh -s workflow          # 브라우저에서 1회 승인
mkdir -p .github/workflows
git mv .github/ci-workflow/deploy.yml .github/workflows/deploy.yml
git commit -am "Enable CI deploy workflow"
git push
```

그다음 GitHub → Settings → Pages → Source를 **GitHub Actions**로 변경한다.
(`gh-pages` 브랜치 배포와 병행하지 말고 하나만 쓴다.)
