const PDF_MIME = "application/pdf";

export const MATERIAL_FILE_ACCEPT =
  ".md,.mdx,.txt,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.css,.yml,.yaml,.docx,.xlsx,.csv,.ppt,.pptx,.pdf,application/pdf";

export function isPdfFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === PDF_MIME || name.endsWith(".pdf");
}

export function splitMaterialFiles(list: FileList | File[]): { pdfs: File[]; other: File[] } {
  const pdfs: File[] = [];
  const other: File[] = [];
  for (const file of list) {
    if (isPdfFile(file)) pdfs.push(file);
    else other.push(file);
  }
  return { pdfs, other };
}
