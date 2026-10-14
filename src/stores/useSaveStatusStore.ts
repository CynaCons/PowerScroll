import { create } from 'zustand';

export type SaveStatus = 'saved-file' | 'saved-browser' | 'saving' | 'needs-permission' | 'error';
interface SaveStatusState {
  status: SaveStatus;
  reason?: string;
  fileName?: string;
  failureReported: boolean;
  setStatus: (status: SaveStatus, reason?: string, fileName?: string) => void;
  setFailureReported: (value: boolean) => void;
}
export const useSaveStatusStore = create<SaveStatusState>((set) => ({
  status: 'saved-browser', failureReported: false,
  setStatus: (status, reason, fileName) => set({ status, reason, fileName }),
  setFailureReported: (failureReported) => set({ failureReported }),
}));
