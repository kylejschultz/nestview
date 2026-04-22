# Contributing to Nestview

Thanks for your interest in contributing. Nestview is a small project — contributions are welcome as long as they stay true to the zero-config, lightweight spirit of the tool.

## Before opening a PR

- For bug fixes, feel free to open a PR directly.
- For new features or significant changes, open an issue first so we can discuss whether it fits the project direction.

## Dev setup

**Backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev   # starts Vite dev server on :5173, proxies /api to :8080
```

You'll need Docker running locally so the collector can reach the Docker socket.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with scoped prefixes: `feat(frontend):`, `fix(backend):`, `docs:`, etc.
- Keep PRs focused — one feature or fix per PR.

## Code of conduct

Don't be a dick. See `LICENSE`.
