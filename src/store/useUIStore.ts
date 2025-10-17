import { create } from 'zustand';

interface UIState {
  orientationAngle: number;
  setOrientationAngle: (angle: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  orientationAngle: 0, // 初期値はポートレート(縦向き)の0度
  setOrientationAngle: (angle) => set({ orientationAngle: angle }),
}));