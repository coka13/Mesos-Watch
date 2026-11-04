# Repository workflow

- Use GitHub origin at https://github.com/coka13/Mesos-Watch.git.
- Fetch origin before development. Start every change on a new feature/* or fix/* branch from the latest origin/dev.
- Never edit or commit on main or dev. Commit and push changes to the feature or fix branch. Use clear branch names and commit messages.
- Open a pull request into dev after tests pass. Resolve conflicts on a feature or fix branch and preserve both sides' intended behavior.
- Keep dev current with validated changes. Promote dev into main through a pull request only after all available tests, lint, type checks, production builds, and relevant regression checks pass.
- Never force-push, rewrite remote history, or discard existing work. Preserve existing code and configuration. Keep credentials, browser profiles, database backups, and local scratch files out of commits.
- Before closing a change, verify remote tracking, branch status, and the working tree. Report any validation or deployment checks that could not run.

This project serves static assets directly from dist/. Run npm ci, npm test, npm run test:ocr, and npm run verify. Run any additional lint, type-check, or build scripts that the project declares.
