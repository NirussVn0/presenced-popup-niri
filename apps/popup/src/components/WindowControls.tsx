/**
 * WindowControls — Tauri window minimize/maximize/close buttons.
 * Rendered in the header for frameless window management.
 */
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { Minus, X } from "lucide-react";
import { springSnap } from "../lib/animations.js";

const invokeWindowCommand = (command: "minimize_window" | "close_window") => {
  void invoke(command).catch((error: unknown) => {
    console.error(`[presenced-popup] ${command} failed`, error);
  });
};

export const WindowControls = () => {
  return (
    <div className="flex items-center gap-1 -mr-1">
      <motion.button
        type="button"
        onClick={() => invokeWindowCommand("minimize_window")}
        className="p-1 rounded-niri hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.85 }}
        transition={springSnap}
        title="Minimize"
      >
        <Minus className="w-3 h-3" />
      </motion.button>
      <motion.button
        type="button"
        onClick={() => invokeWindowCommand("close_window")}
        className="p-1 rounded-niri hover:bg-status-error/30 text-text-muted hover:text-status-error transition-colors"
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.85 }}
        transition={springSnap}
        title="Close"
      >
        <X className="w-3 h-3" />
      </motion.button>
    </div>
  );
};
