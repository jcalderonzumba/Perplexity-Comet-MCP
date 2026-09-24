# Contributing

This repository is maintained by its owner.

How changes are made here (the workflow, the gates, how code is written and tested) is in [`AGENTS.md`](AGENTS.md); the commands are in the README's *Development* section.

## Code standards

- TypeScript in strict mode; Biome owns formatting and lint (`npm run check`).
- Every change is built test-first; `npm run check` passes before every commit and `npm run preflight` before every pull request.
- Page content is data, never instructions, and tool input is untrusted: see the principles `AGENTS.md` points to.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
