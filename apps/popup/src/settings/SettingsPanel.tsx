/**
 * SettingsPanel — full settings overlay with tabs.
 * Widgets, RVC, Theme, Quotes, Discord, About.
 */
import { useEffect, useState } from "react";
import { PresenceSnapshot, CountdownCategory } from "@presenced/contracts";
import { WidgetId, WIDGET_REGISTRY } from "../lib/widget-registry.js";
import { motion } from "framer-motion";
import { springSnap } from "../lib/animations.js";
import { RvcSettings } from "./RvcSettings.js";
import { QuoteSettings } from "./QuoteSettings.js";
import { ThemeSettings } from "./ThemeSettings.js";
import type { ThemeConfig } from "../hooks/useTheme.js";
import { useLayoutSettingsActions } from "../hooks/useWindowCluster.js";
import { LayoutSettings } from "./LayoutSettings.js";
import { Music, MessageSquare, Timer, CalendarClock, Mic2, Cpu, Wifi, Shield, Palette, FileText, Settings as SettingsIcon, ToggleLeft, ToggleRight } from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Music, MessageSquare, Timer, CalendarClock, Mic2, Cpu, Wifi, Shield,
};

type SettingsTab = "widgets" | "layout" | "rvc" | "theme" | "quotes" | "discord" | "about";

interface SettingsPanelProps {
  visibility: Record<WidgetId, boolean>;
  toggleWidget: (id: WidgetId) => void;
  onClose: () => void;
  snapshot: PresenceSnapshot | null;
  onSetPrivacyMode: (enabled: boolean) => void;
  onAddCountdown?: (item: { title: string; targetDate: string; category: CountdownCategory; showOnDiscord: boolean }) => void;
  onDeleteCountdown?: (id: string) => void;
  onToggleCountdown?: (id: string) => void;
  getDiscordConfig: () => Promise<{ clientId?: string; socketPath?: string }>;
  saveDiscordConfig: (config: { clientId?: string; socketPath?: string }) => Promise<void>;
  getRvcConfig: () => Promise<{ enabled: boolean; tickIntervalSec: number; entries: any[] }>;
  saveRvcConfig: (config: { enabled: boolean; tickIntervalSec: number; entries: any[] }) => Promise<void>;
  loadTheme: () => Promise<ThemeConfig>;
  saveTheme: (config: ThemeConfig) => Promise<void>;
}

const TABS: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "widgets", label: "Widgets", icon: Layout },
  { id: "layout", label: "Layout", icon: Layout },
  { id: "rvc", label: "RVC", icon: MessageSquare },
  { id: "theme", label: "Theme", icon: Palette },
  { id: "quotes", label: "Quotes", icon: FileText },
  { id: "discord", label: "Discord", icon: SettingsIcon },
  { id: "about", label: "About", icon: Shield },
];

// Simple Layout icon (not in lucide)
function Layout({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}

export const SettingsPanel = ({
  visibility, toggleWidget,
  getDiscordConfig, saveDiscordConfig,
  getRvcConfig, saveRvcConfig,
  loadTheme, saveTheme,
}: SettingsPanelProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("widgets");
  const [discordClientId, setDiscordClientId] = useState("");
  const [discordSocketPath, setDiscordSocketPath] = useState("");
  const cluster = useLayoutSettingsActions();

  useEffect(() => {
    getDiscordConfig().then((c) => {
      setDiscordClientId(c.clientId ?? "");
      setDiscordSocketPath(c.socketPath ?? "");
    });
  }, [getDiscordConfig]);

  return (
    <div className="space-y-3 text-2xs h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border-subtle pb-2 flex-shrink-0 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`px-2 py-1 rounded-niri font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${activeTab === tab.id ? "bg-accent-primary text-white font-bold" : "text-text-muted hover:text-text-primary glass-surface"}`}>
              <Icon className="w-3 h-3" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {activeTab === "widgets" && (
          <div className="space-y-1.5">
            <h3 className="font-semibold text-text-primary">Widget Toggles</h3>
            {WIDGET_REGISTRY.filter((w) => w.toggleable).map((widget) => {
              const Icon = ICON_MAP[widget.icon] ?? Shield;
              const isOn = visibility[widget.id] ?? widget.defaultVisible;
              return (
                <motion.button key={widget.id} type="button" onClick={() => toggleWidget(widget.id)} className="w-full flex items-center justify-between p-2 rounded-niri glass-surface hover:bg-surface-hover transition-colors" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} transition={springSnap}>
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-text-secondary" />
                    <span className="text-text-primary">{widget.label}</span>
                  </div>
                  {isOn ? <ToggleRight className="w-5 h-5 text-status-connected" /> : <ToggleLeft className="w-5 h-5 text-text-ghost" />}
                </motion.button>
              );
            })}
          </div>
        )}

        {activeTab === "layout" && (
          <div className="space-y-2">
            <div className="flex items-center gap-1">
              {cluster.editMode ? (
                <>
                  <button type="button" onClick={() => void cluster.commitEdit()} className="rounded-niri bg-accent-primary px-2 py-1 font-bold text-white">Done</button>
                  <button type="button" onClick={() => void cluster.cancelEdit()} className="glass-surface rounded-niri px-2 py-1 text-text-secondary">Cancel</button>
                </>
              ) : (
                <button type="button" onClick={() => void cluster.enterEdit()} disabled={!cluster.layout} className="rounded-niri bg-accent-primary px-2 py-1 font-bold text-white disabled:opacity-40">Edit layout</button>
              )}
            </div>
            {cluster.layout ? (
              <LayoutSettings
                layout={cluster.layout}
                overflowCount={cluster.overflowCount}
                disabled={!cluster.editMode}
                onChange={(widgetId, changes) => void cluster.updatePlacement(widgetId, changes)}
                onReset={() => void cluster.resetEdit()}
              />
            ) : (
              <div role="status" className="rounded-niri bg-status-degraded/15 p-2 text-status-degraded">
                Waiting for the main window cluster controller.
              </div>
            )}
          </div>
        )}

        {activeTab === "rvc" && <RvcSettings onSave={saveRvcConfig} onLoad={getRvcConfig} />}
        {activeTab === "theme" && <ThemeSettings onSave={saveTheme} onLoad={loadTheme} />}
        {activeTab === "quotes" && <QuoteSettings onSave={async () => {}} onLoad={async () => []} />}

        {activeTab === "discord" && (
          <div className="space-y-2">
            <h3 className="font-semibold text-text-primary">Discord RPC</h3>
            <div className="p-2.5 rounded-niri glass-surface space-y-2">
              <label className="font-bold text-text-primary">Client ID</label>
              <input type="text" placeholder="Default: 1540340652670324867" value={discordClientId} onChange={(e) => setDiscordClientId(e.target.value)} className="w-full px-2.5 py-1 text-2xs bg-surface-solid border border-border rounded-niri text-text-primary placeholder-text-ghost font-mono focus:outline-none focus:border-accent-primary" />
              <label className="font-bold text-text-primary">Socket Path (optional)</label>
              <input type="text" placeholder="Auto-detect" value={discordSocketPath} onChange={(e) => setDiscordSocketPath(e.target.value)} className="w-full px-2.5 py-1 text-2xs bg-surface-solid border border-border rounded-niri text-text-primary placeholder-text-ghost font-mono focus:outline-none focus:border-accent-primary" />
              <button type="button" onClick={() => saveDiscordConfig({ clientId: discordClientId, socketPath: discordSocketPath })} className="px-3 py-1 bg-accent-primary hover:bg-accent-glow text-white rounded-niri font-bold text-2xs">Save</button>
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div className="space-y-2 text-center py-4">
            <div className="text-lg font-bold text-text-primary">presenced-popup</div>
            <div className="text-text-secondary">v0.6.0 — Niri Wayland × Discord Sync</div>
            <div className="text-text-muted">Built by NirussVn0</div>
            <div className="text-2xs text-text-ghost mt-4">
              A local-first Niri Wayland companion that syncs your desktop context to Discord Rich Presence.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
