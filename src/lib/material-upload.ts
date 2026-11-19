const PDF_MIME = "application/pdf";

// The file chooser and folder reader share this list. Extensionless project
// files are recognized by name in the reader (the chooser accepts extensions).
export const MATERIAL_EXTENSIONS = [
  "md", "mdx", "txt", "rst", "adoc", "log",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "kts",
  "rb", "php", "swift", "cs", "c", "h", "cc", "cpp", "hpp", "sh", "bash", "zsh", "ps1",
  "html", "htm", "css", "scss", "sass", "less", "vue", "svelte",
  "json", "jsonl", "ndjson", "yml", "yaml", "toml", "ini", "xml", "sql", "graphql", "gql", "proto",
  "ipynb", "tsv", "docx", "xlsx", "csv", "ppt", "pptx",
] as const;

export const MATERIAL_FILE_ACCEPT = [...MATERIAL_EXTENSIONS.map((ext) => `.${ext}`), ".pdf", PDF_MIME].join(",");

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
