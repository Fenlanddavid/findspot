export type BackupImportProgress = {
  phase: 'reading' | 'validating' | 'drilling' | 'restoring';
  processedBytes: number;
  totalBytes: number;
  percent: number;
};

export type BackupImportOptions = {
  onProgress?: (progress: BackupImportProgress) => void;
};
