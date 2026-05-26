"use client";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

interface PDFViewerProps {
  file: File | string;
  onLoadSuccess: ({ numPages }: { numPages: number }) => void;
  onLoadError: (error: Error) => void;
  numPages: number;
  pdfWidth: number;
  pdfError: Error | null;
}

export default function PDFViewer({
  file,
  onLoadSuccess,
  onLoadError,
  numPages,
  pdfWidth,
  pdfError,
}: PDFViewerProps) {
  return (
    <Document
      file={file}
      onLoadSuccess={onLoadSuccess}
      onLoadError={onLoadError}
      loading={
        <div className="flex items-center justify-center h-64">
          <p>Loading PDF...</p>
        </div>
      }
      error={
        pdfError ? (
          <div className="flex items-center justify-center h-64 text-red-500">
            <p>Failed to load PDF: {pdfError.message}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64">
            <p>Error loading PDF</p>
          </div>
        )
      }
    >
      <div className="flex flex-col items-center gap-4 w-full overflow-x-auto">
        {Array.from(new Array(numPages), (el, index) => {
          const pageNum = index + 1;
          return (
            <div
              key={`page_${pageNum}`}
              data-page-number={pageNum}
              className="border-b border-gray-200 pb-4 last:border-b-0 flex justify-center"
              style={{ maxWidth: "100%" }}
            >
              <Page
                pageNumber={pageNum}
                width={pdfWidth}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="max-w-full"
              />
            </div>
          );
        })}
      </div>
    </Document>
  );
}

export { pdfjs };
