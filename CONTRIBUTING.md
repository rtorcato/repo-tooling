# Contributing to repo-tooling

Thank you for your interest in contributing to repo-tooling! This document provides guidelines and information for contributors.

## 🚀 Getting Started

### Prerequisites

- **Node.js**: Version 22 or higher
- **pnpm**: Package manager (recommended)
- **Git**: Version control

### Development Setup

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/your-username/repo-tooling.git
   cd repo-tooling
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Build the CLI:**
   ```bash
   pnpm run build-cli
   ```

4. **Link for local testing:**
   ```bash
   pnpm link --global
   ```

## 📋 Development Workflow

### Branch Naming

Use descriptive branch names with prefixes:
- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `chore/` - Maintenance tasks
- `refactor/` - Code refactoring

Example: `feat/add-webpack-config` or `fix/eslint-rule-conflict`

### Commit Messages

We use [Conventional Commits](https://conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

**Examples:**
```bash
feat: add TypeScript configuration for Vite projects
fix: resolve ESLint rule conflict in React preset
docs: update CLI usage examples in README
chore: update dependencies to latest versions
```

> **PR title length:** commitlint enforces a 100-char subject limit. GitHub's
> squash-merge appends ` (#N)` to the title — keep PR titles ≤ 93 chars so
> the merged commit doesn't trip the post-merge `commitlint` gate (which
> would then skip the `release` job). Body and footer line length are not
> enforced.

### Code Quality

We use several tools to maintain code quality:

- **Biome**: Linting and formatting
- **TypeScript**: Type checking
- **Husky**: Git hooks
- **Commitlint**: Commit message validation

Before committing, run:
```bash
# Check code quality
pnpm run check

# Fix auto-fixable issues
pnpm run check:fix

# Run tests
pnpm run test
```

## 🛠️ Project Structure

```
repo-tooling/
├── src/cli/              # CLI source code
│   ├── index.ts          # Main CLI entry point
│   ├── commands/         # CLI commands
│   └── generators/       # Configuration generators
├── tooling/              # Tool configurations
│   ├── biome/           # Biome configurations
│   ├── eslint/          # ESLint presets
│   ├── typescript/      # TypeScript configs
│   └── ...              # Other tools
├── scripts/             # Build and utility scripts
└── tests/               # Test files
```

## 🔧 Adding New Tools

When adding support for a new development tool:

1. **Create tool directory:**
   ```bash
   mkdir tooling/your-tool
   ```

2. **Add configuration files:**
   - Base configuration
   - Variants for different project types
   - Documentation

3. **Update package.json exports:**
   ```json
   "./your-tool": "./tooling/your-tool/index.js"
   ```

4. **Add CLI generator (optional):**
   Create generator in `src/cli/generators/your-tool.ts`

5. **Update README.md:**
   Document the new tool in the available tools section

## 📖 Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for functions and classes
- Update CLI help text when adding commands
- Include examples in tool documentation
- Setting up a library docs site? See the
  [Docs site that stays in sync](apps/docs/docs/guides/docs-site.md) guide —
  shared TypeDoc helper (`@rtorcato/repo-tooling/docusaurus`) + reusable
  `docs-deploy.yml` workflow.

## 🧪 Testing

### Running Tests

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run with coverage
pnpm run coverage
```

### Writing Tests

- Place tests in the `tests/` directory
- Use descriptive test names
- Test both success and error cases
- Mock external dependencies when appropriate

Example test structure:
```typescript
import { describe, it, expect } from 'vitest'
import { yourFunction } from '../src/your-module'

describe('yourFunction', () => {
  it('should handle valid input correctly', () => {
    const result = yourFunction('valid input')
    expect(result).toBe('expected output')
  })

  it('should throw error for invalid input', () => {
    expect(() => yourFunction('')).toThrow('Invalid input')
  })
})
```

## 🚢 Release Process

Releases are automated using semantic-release:

1. **Merge to main:** Changes are automatically released when merged to main
2. **Version calculation:** Based on conventional commit messages
3. **Changelog generation:** Automatic based on commits
4. **npm publication:** Automated via GitHub Actions

## 📝 Pull Request Guidelines

### Before Submitting

- [ ] Code follows project conventions
- [ ] Tests pass locally (`pnpm run test`)
- [ ] Code quality checks pass (`pnpm run check`)
- [ ] Documentation updated if needed
- [ ] CLI builds successfully (`pnpm run build-cli`)

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring
- [ ] Other (please describe)

## Testing
- [ ] Added tests for new functionality
- [ ] All tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No breaking changes (or properly documented)
```

## 💬 Getting Help

- **Issues**: Report bugs or request features via [GitHub Issues](https://github.com/rtorcato/repo-tooling/issues)
- **Discussions**: Ask questions in [GitHub Discussions](https://github.com/rtorcato/repo-tooling/discussions)
- **CLI Help**: Run `npx @rtorcato/repo-tooling --help` for usage information

## 📄 License

By contributing to repo-tooling, you agree that your contributions will be licensed under the MIT License.

## 🙏 Recognition

Contributors will be recognized in:
- GitHub contributors list
- Release notes (for significant contributions)
- Documentation acknowledgments

Thank you for contributing to repo-tooling! 🎉