import { create } from 'zustand';

interface UIState {
  orientationAngle: number;
  setOrientationAngle: (angle: number) => void;
}

export const useUIStore = create<UIState>((set) => ({
  orientationAngle: 0,
  setOrientationAngle: (angle) => set({ orientationAngle: angle }),
}));