import { FolderOpen, Upload } from "lucide-react";
import { useRef, type DragEvent } from "react";
import { DropzoneCard } from "@/components/ui/dropzone-card";
import { MATERIAL_FILE_ACCEPT, splitMaterialFiles } from "@/lib/material-upload";

type MaterialUploadPanelProps = {
  disabled?: boolean;
  folderReading?: boolean;
  onFolderClick: () => void;
  onFiles: (files: File[]) => void | Promise<void>;
  onPdfs: (files: File[]) => void | Promise<void>;
  testId?: string;
};

export function MaterialUploadPanel({
  disabled,
  folderReading,
  onFolderClick,
  onFiles,
  onPdfs,
  testId = "material-upload",
}: MaterialUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function ingest(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    const { pdfs, other } = splitMaterialFiles(list);
    if (other.length > 0) await onFiles(other);
    if (pdfs.length > 0) await onPdfs(pdfs);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (disabled || folderReading) return;
    void ingest(event.dataTransfer.files);
  }

  return (
    <div className="space-y-3" data-testid={testId}>
      <div
        className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={onDrop}
      >
        <DropzoneCard
          icon={<Upload aria-hidden />}
          title="Add files"
          description="Drop files here or click to browse"
          footer="PDF, Word, Excel, PowerPoint, code, markdown, and text"
          disabled={disabled || folderReading}
          testId="upload-files-button"
          onClick={() => inputRef.current?.click()}
        />
        <DropzoneCard
          icon={<FolderOpen aria-hidden />}
          title="Add local folder"
          description="Choose a project folder on this device"
          footer="Remote Git URLs are not supported in beta"
          disabled={disabled || folderReading}
          testId="upload-folder-button"
          onClick={onFolderClick}
        />
      </div>
      <p className="text-xs text-muted">
        One upload area handles every file type. PDFs are indexed separately from code and office docs. To use a GitHub
        repo, clone it locally first, then choose the folder.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MATERIAL_FILE_ACCEPT}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          void ingest(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
