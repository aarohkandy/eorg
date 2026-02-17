# Publishing To GitHub

## 1. Initialize Git (if needed)

```bash
cd /home/a-a-k/Downloads/eorg
git init
git add .
git commit -m "feat: initial Gmail Hard Reskin extension"
```

## 2. Create GitHub Repository

Create a new empty repository on GitHub, then connect it:

```bash
git remote add origin git@github.com:<your-user>/<your-repo>.git
git branch -M main
git push -u origin main
```

## 3. Tag A Release

```bash
git tag -a v0.2.0 -m "Gmail Hard Reskin v0.2.0"
git push origin v0.2.0
```

## 4. Optional: GitHub Release Notes

Use `CHANGELOG.md` as the release body and attach screenshots/GIFs from Gmail.
