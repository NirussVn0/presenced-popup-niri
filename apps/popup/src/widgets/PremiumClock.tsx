/**
 * PremiumClock — sci-fi styled clock with date, greeting, and ambient glow.
 * Beautiful, large, centered clock display.
 */
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { springNiri } from "../lib/animations.js";

interface PremiumClockProps {
  userName?: string;
  wsConnected?: boolean;
  clockStyle?: "digital" | "analog" | "minimal";
}

export const PremiumClock = ({ userName = "Niruss", wsConnected, clockStyle = "digital" }: PremiumClockProps) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const i = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const hours = String(time.getHours()).padStart(2, "0");
  const minutes = String(time.getMinutes()).padStart(2, "0");
  const seconds = String(time.getSeconds()).padStart(2, "0");

  const dateStr = time.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const getGreeting = () => {
    const h = time.getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <motion.div
      className="glass-float rounded-niri-xl p-4 text-center select-none relative overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springNiri}
    >
      {/* Ambient glow behind clock */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(124,138,255,0.08) 0%, transparent 70%)",
        }}
      />

      {clockStyle === "digital" && (
        <div className="text-2xs text-text-secondary mb-1 relative">
          {getGreeting()}, <span className="text-text-primary font-semibold">{userName}</span>
        </div>
      )}

      {clockStyle === "analog" ? (
        <div className="flex justify-center relative">
          <svg viewBox="0 0 100 100" className="w-20 h-20" aria-label="Analog clock">
            <circle cx="50" cy="50" r="46" className="fill-none stroke-border" strokeWidth="3" />
            <line
              x1="50" y1="50"
              x2={50 + 24 * Math.sin(((time.getHours() % 12) / 12) * 2 * Math.PI)}
              y2={50 - 24 * Math.cos(((time.getHours() % 12) / 12) * 2 * Math.PI)}
              className="stroke-text-primary"
              strokeWidth="5" strokeLinecap="round"
            />
            <line
              x1="50" y1="50"
              x2={50 + 36 * Math.sin((time.getMinutes() / 60) * 2 * Math.PI)}
              y2={50 - 36 * Math.cos((time.getMinutes() / 60) * 2 * Math.PI)}
              className="stroke-accent-primary"
              strokeWidth="3" strokeLinecap="round"
            />
            <circle cx="50" cy="50" r="3" className="fill-accent-primary" />
          </svg>
        </div>
      ) : (
        <>
          {/* Clock */}
          <div className="flex items-baseline justify-center gap-0.5 relative">
            <span className="text-4xl font-black font-mono text-text-primary tracking-tighter">
              {hours}
            </span>
            <motion.span
              className="text-4xl font-black font-mono text-accent-primary"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              :
            </motion.span>
            <span className="text-4xl font-black font-mono text-text-primary tracking-tighter">
              {minutes}
            </span>
            {clockStyle === "digital" && <span className="text-lg font-mono text-text-muted ml-1">{seconds}</span>}
          </div>
        </>
      )}

      {/* Date + Connection */}
      <div className="flex items-center justify-center gap-3 mt-1.5 relative">
        <span className="text-2xs text-text-muted font-mono">{dateStr}</span>
        <span className="text-2xs text-text-ghost">·</span>
        <span className="flex items-center gap-1 text-2xs">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              wsConnected ? "bg-status-connected" : "bg-status-degraded"
            }`}
          />
          <span className="text-text-muted">{wsConnected ? "Synced" : "Offline"}</span>
        </span>
      </div>
    </motion.div>
  );
};
