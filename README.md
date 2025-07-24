# Aster - React Router Chat App with WebLLM

[![CI](https://github.com/your-username/aster/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/aster/actions/workflows/ci.yml)

A modern chat application built with React Router and powered by WebLLM for
client-side AI inference.

## Features

- 🤖 **Real AI Chat**: Powered by WebLLM with local model inference
- 🚀 **Streaming Responses**: Real-time streaming of AI responses
- 📱 **Modern UI**: Clean, responsive interface with dark mode support
- 🔄 **Dynamic Model Selection**: Choose from 100+ available models organized by
  category
- 💾 **Local Processing**: All AI processing happens in your browser
- ⚡ **Fast Loading**: Optimized model loading with progress tracking

## Available Models

The app dynamically loads all available models from WebLLM, including:

### Llama Models

- **Llama 3.1**: 8B and 70B parameter models
- **Llama 3.2**: 1B and 3B parameter models
- **Llama 3**: 8B and 70B parameter models
- **Llama 2**: 7B and 13B parameter models

### Qwen Models

- **Qwen 3**: 0.6B, 1.7B, 4B, and 8B parameter models
- **Qwen 2.5**: 0.5B, 1.5B, 3B, and 7B parameter models (including Math and
  Coder variants)
- **Qwen 2**: 0.5B, 1.5B, and 7B parameter models

### Other Popular Models

- **Phi**: 1.5, 2, 3 Mini, and 3.5 Mini models (including vision capabilities)
- **Gemma**: 2B and 9B parameter models
- **Mistral**: 7B parameter models
- **Hermes**: Various instruction-tuned models
- **DeepSeek**: R1 models
- **SmolLM**: Lightweight models (135M, 360M, 1.7B parameters)
- **TinyLlama**: 1.1B parameter models
- **StableLM**: Zephyr models
- **WizardMath**: Math-focused models

### Model Categories

Models are organized into categories and include information about:

- **VRAM Requirements**: Memory needed to run the model
- **Resource Level**: Whether the model is optimized for low-resource devices
- **Specialization**: Math, coding, vision, or general-purpose models

## Getting Started

1. **Install dependencies**:

   ```bash
   npm install
   ```

2. **Start the development server**:

   ```bash
   npm run dev
   ```

3. **Open your browser** and navigate to the chat page

## How It Works

The app uses [WebLLM](https://github.com/mlc-ai/web-llm) to run large language
models directly in your browser. This means:

- No server costs or API keys required
- Complete privacy - your conversations stay on your device
- Works offline after initial model download
- Real-time streaming responses
- Access to 100+ pre-trained models

## Model Selection

The app automatically loads all available models from WebLLM and organizes them
by category. You can:

- **Browse by Category**: Models are grouped by family (Llama, Qwen, Phi, etc.)
- **Filter by Size**: Choose from small models (135M parameters) to large models
  (70B parameters)
- **Select by Specialization**: Pick models optimized for math, coding, vision,
  or general chat
- **Consider Resources**: Models are marked as low-resource or standard based on
  VRAM requirements

## First Load

On first load, the app will download and initialize the selected model. This may
take a few minutes depending on your internet connection. The model will be
cached for faster subsequent loads.

## Development

### Tech Stack

- Built with React Router v7
- TypeScript for type safety
- Tailwind CSS for styling
- WebLLM for AI inference
- Vitest for testing
- Prettier for code formatting

### Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Format code
npm run format

# Build for production
npm run build
```

### Chat Implementation

The app includes two chat implementations:

- `/chat` - Original implementation using xstate for state management
- `/chat-new` - New implementation using useReducer for simpler state management

### CI/CD

The project includes a GitHub Actions workflow that:

- ✅ Runs all tests with verbose output
- ✅ Checks code formatting with Prettier
- ✅ Performs TypeScript type checking
- ✅ Builds the application for production
- ✅ Uploads build artifacts

The workflow runs on pushes and pull requests to `main` and `develop` branches.

## Deployment

This app is configured for Cloudflare Pages deployment:

```bash
npm run deploy
```

## License

MIT
