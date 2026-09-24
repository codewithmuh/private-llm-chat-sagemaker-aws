"use client";

import { PageHeader } from "@/components/chat/ChatHeader";
import { OcrTool } from "@/components/ocr/OcrTool";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function OcrPage() {
  useDocumentTitle("OCR tool");
  return (
    <>
      <PageHeader>
        <h1 style={{ fontSize: 18, fontWeight: 600, paddingLeft: 8 }}>OCR tool</h1>
      </PageHeader>
      <OcrTool />
    </>
  );
}
