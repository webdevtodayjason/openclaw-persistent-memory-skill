# Contributing to OpenClaw-Mem

Thank you for your interest in contributing to OpenClaw-Mem! This document provides guidelines for contributing.

## Code of Conduct

Be respectful and constructive. We're building something useful together.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Create** a feature branch: `git checkout -b feature/your-feature`
5. **Make** your changes
6. **Test** your changes: `npm test`
7. **Commit** with clear messages
8. **Push** to your fork
9. **Open** a Pull Request

## Development Setup

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/openclaw-mem
cd openclaw-mem

# Install
npm install

# Start dev server (watches for changes)
npm run dev

# Run tests
npm test

# Build
npm run build
```

## Project Structure

```
openclaw-mem/
├── src/
│   ├── database/      # SQLite storage layer
│   ├── hooks/         # OpenClaw lifecycle hooks
│   ├── worker/        # HTTP API server
│   ├── search/        # Search engine (FTS5 + Chroma)
│   ├── mcp/           # MCP tool implementations
│   ├── index.ts       # Main exports
│   └── cli.ts         # CLI tool
├── ui/                # Web viewer (React)
├── tests/             # Test suites
├── docs/              # Documentation
└── scripts/           # Build & utility scripts
```

## Coding Standards

- **TypeScript** - All code must be TypeScript
- **ESLint** - Run `npm run lint` before committing
- **Prettier** - Run `npm run format` for consistent formatting
- **Tests** - Add tests for new functionality

## Commit Messages

Use clear, descriptive commit messages:

```
feat: Add vector search with Chroma integration
fix: Handle database connection errors gracefully
docs: Update API endpoint documentation
test: Add tests for search functionality
chore: Update dependencies
```

## Pull Request Process

1. Update documentation for any new features
2. Add tests for new functionality
3. Ensure all tests pass
4. Update CHANGELOG.md if applicable
5. Request review from maintainers

## What to Contribute

### Good First Issues
- Documentation improvements
- Bug fixes
- Test coverage
- Code cleanup

### Feature Ideas
- Web UI improvements
- Additional search filters
- Performance optimizations
- New observation types

### Major Contributions
For major features, please open an issue first to discuss:
- Architecture changes
- New integrations
- Breaking changes

## Testing

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Watch mode
npm test -- --watch
```

## Documentation

- Update README.md for user-facing changes
- Update docs/ARCHITECTURE.md for internal changes
- Add JSDoc comments for public APIs

## Questions?

- Open a GitHub issue
- Join the OpenClaw Discord: https://discord.com/invite/clawd

## License

By contributing, you agree that your contributions will be licensed under AGPL-3.0.
