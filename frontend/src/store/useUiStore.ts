import { create } from "zustand";

export type UiState = {
  isDetailVisible: boolean;
  toggleDetail: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  isDetailVisible: false,
  toggleDetail: () =>
    set((state) => ({
      isDetailVisible: !state.isDetailVisible,
    })),
}));
