# Contributing to Aster

Thank you for your interest in contributing to Aster! This guide will help you
get started.

## Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/your-username/aster.git
   cd aster
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

## Development Workflow

### Before Making Changes

1. **Create a new branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Run tests to ensure everything works**
   ```bash
   npm test
   ```

### Making Changes

1. **Write tests for new functionality**
   - Add tests to the appropriate `*.test.ts` files
   - Ensure all tests pass with `npm test`

2. **Follow TypeScript best practices**
   - Use proper types for all functions and variables
   - Run `npm run typecheck` to catch type errors

3. **Format your code**
   ```bash
   npm run format
   ```

### Before Submitting

Make sure all CI checks will pass:

```bash
# Run all CI checks locally
npm test -- --no-watch --reporter=verbose
npm run format:check
npm run typecheck
npm run build
```

## Pull Request Process

1. **Push your changes**

   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create a Pull Request**
   - Use a clear, descriptive title
   - Describe what changes you made and why
   - Reference any related issues

3. **CI Checks**
   - All tests must pass
   - Code must be properly formatted
   - TypeScript must compile without errors
   - Build must succeed

4. **Review Process**
   - Address any feedback from reviewers
   - Keep your branch up to date with main

## Code Standards

### TypeScript

- Use strict TypeScript configuration
- Prefer explicit types over `any`
- Use proper error handling

### React

- Use functional components with hooks
- Prefer `useReducer` for complex state management
- Follow React best practices for performance

### Testing

- Write comprehensive tests for new features
- Use descriptive test names
- Mock external dependencies (like web-llm)

### Formatting

- Code is automatically formatted with Prettier
- Run `npm run format` before committing

## Project Structure

```
app/
├── lib/           # Shared utilities and hooks
├── routes/        # React Router pages
└── welcome/       # Welcome page components

tests/
├── test-setup.ts  # Global test configuration
└── utils.ts       # Test utilities

.github/
└── workflows/
    └── ci.yml     # GitHub Actions CI workflow
```

## Chat Implementation

The project has two chat implementations:

- **Original (`/chat`)**: Uses xstate for state management
- **New (`/chat-new`)**: Uses useReducer for simpler state management

When contributing to chat functionality, prefer the new useReducer-based
implementation.

## Getting Help

- Check existing issues for similar problems
- Create a new issue for bugs or feature requests
- Ask questions in discussions

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
