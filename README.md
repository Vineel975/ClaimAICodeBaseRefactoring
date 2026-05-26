# TPA PDF Processing Pipeline - Next.js Web App

A web-based PDF processing pipeline for extracting structured data from hospital bills using AI models.

## Features

- **Web-based UI**: Modern interface built with Next.js and shadcn/ui
- **Real-time Progress**: Live updates on processing status
- **Multiple AI Providers**: Support for OpenAI and OpenRouter
- **Fallback Retry**: Automatic retry with fallback models on validation failures
- **Export Results**: Download results as JSON

## Setup

1. Install dependencies :

```bash
bun install
```

2. Set up environment variables in `.env.local`:

```env
# Required based on your provider choice
OPENROUTER_API_KEY=your-key-here
# OR
OPENAI_API_KEY=your-key-here
```

3. Run the development server:

```bash
bun run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

1. **Configure Settings**:
   - Enter the PDF directory path (server-side path)
   - Select your AI model name (e.g., `google/gemini-3-flash-preview`)
   - Choose your provider (OpenAI or OpenRouter)
   - Optionally configure fallback model and retry count

2. **Start Processing**:
   - Click "Start Processing" to begin
   - Watch real-time progress updates
   - View file-by-file status and statistics

3. **Download Results**:
   - Once processing completes, download results as JSON
   - Results include extracted data, validation results, and statistics

## API Endpoints

- `POST /api/process` - Start processing PDFs
- `GET /api/status` - Get current processing status
- `GET /api/download?format=json` - Download results

## Architecture

- **Frontend**: Next.js 16 with React Server Components
- **UI Components**: shadcn/ui
- **Backend**: Next.js API Routes
- **Processing**: Server-side processing with progress tracking
- **State Management**: In-memory processing service

## Notes

- PDF directory must be accessible from the server
- Processing runs asynchronously - status is polled every second
- Results are stored in memory until download

