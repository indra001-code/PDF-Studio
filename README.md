# PDF Studio

PDF Studio is a browser-based workspace for editing, organizing, and converting PDF files. PDF rendering and file processing happen locally in your browser; documents are not uploaded to a server.

## Features

- Preview PDFs with page thumbnails, navigation, and zoom.
- Add and edit text, typed signature marks, images, highlights, and vector shapes.
- Crop, rotate, delete, and reorder pages; undo and redo edits.
- Merge multiple PDFs.
- Export PDF pages as PNG images, or create a PDF from images supported by your browser.
- Download edited PDFs or a ZIP archive of page images.

## Requirements

- Node.js and npm
- A modern browser

## Run locally

```sh
npm install
npm run dev
```

Vite prints the local development URL in the terminal.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

## Usage notes

- Each input file can be up to 50 MB; total input is limited to 150 MB and 200 pages per workspace.
- Password-protected PDFs and replacing existing PDF text are not supported.
- Signature marks are visual text annotations, not certificate-based digital signatures.
- Image format support depends on browser decoding capabilities. If an image cannot be opened, convert it to JPG or PNG and try again.

## Technology

React, Vite, pdf-lib, PDF.js, JSZip, and lucide-react.
