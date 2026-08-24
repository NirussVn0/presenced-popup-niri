# presenced-popup — Niri Wayland × Discord Sync

<div align="center">

![Linux](https://img.shields.io/badge/Platform-Linux%20%28Wayland%2FNiri%29-1793d1?style=for-the-badge&logo=linux&logoColor=white)
![Tauri v2](https://img.shields.io/badge/Companion-Tauri%20v2-24c8db?style=for-the-badge&logo=tauri&logoColor=white)
![React 19](https://img.shields.io/badge/Frontend-React%2019-61dafb?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/Codebase-TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-110%20Passing-10b981?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**A local-first Niri Wayland companion that syncs your desktop context, music, lyrics, and focus state to Discord Rich Presence in real-time.**

Niri desktop → presenced daemon → Discord RPC (official / Equicord / Vencord)

[Key Features](#-key-features) • [Architecture](#-system-architecture) • [Build Tutorial](#-step-by-step-build-tutorial) • [Niri Integration](#-niri-wayland-integration) • [Testing](#-testing--quality-gates)

</div>

---

## 🌟 Overview

`presenced-popup` is a **Niri Wayland companion** that syncs your desktop context to **Discord Rich Presence** in real-time. It captures what you're doing on Niri — browsing, coding, listening to music, studying with Pomodoro — and publishes it as a polished Discord status.

Works with **official Discord**, **Equicord**, and **Vencord** via the standard Discord IPC socket.

It delivers:

1. **The Daemon (`apps/daemon`)**: A headless background engine that processes real-time Niri + MPRIS event streams, resolves conflicting desktop activities using deterministic priority weighting, matches synced lyrics, and publishes rate-controlled Discord Rich Presence.
2. **The Companion Popup (`apps/popup`)**: A floating Tauri v2 desktop companion (React 19, WebKit2GTK) featuring glassmorphic UI, animated audio waveform, 3-line focused lyrics, interactive media controls, Pomodoro timers, and slide-over settings.
3. **The Web Dashboard (`apps/web`)**: A diagnostic control center for configuring rules, overrides, and integrations.

---

## ✨ Key Features

- **🪟 Niri-Native Context**: Connects directly to `niri msg --json event-stream`. Tracks active workspaces, focused outputs (`DP-4` vs `HDMI-A-3`), and preserves desktop focus context when the companion popup gains focus.
- **🎵 Synchronized Lyrics Engine**: Integrates with [LRCLIB](https://lrclib.net) with local SQLite caching. Parses all LRC timestamp variants and uses $O(\log n)$ binary search with monotonic playback clock anchoring to render smooth, jitter-free lyrics.
- **⏯️ Interactive Media Controls**: Control any MPRIS-compatible player (Spotify, Feishin, Firefox, Chromium) with Play/Pause, Next, and Previous buttons directly in the popup.
- **⏱️ Authoritative Pomodoro Engine**: Integrated 25-minute focus intervals and short/long break counters with live Discord RPC broadcasting.
- **🎯 Milestone Countdowns**: Track days and hours remaining until exams, project launches, or holidays with automatic urgency highlights.
- **📊 Linux Hardware Telemetry**: Pure Node.js `/proc` and `/sys` reader tracking CPU load, RAM usage, system uptime, and battery state without spawning heavy subprocesses.
- **🎨 Custom RPC Template Engine**: Safe, expression-free token substitution (`{track}`, `{artist}`, `{lyric}`, `{pomodoro.remaining}`, `{countdown.days}`, `{system.cpu}`) to customize your Discord presence.
- **🔒 Privacy by Default**: Automatic token redaction, sensitive app filtering (password managers, private browsers), and instant global privacy masking.

---

## 🏗️ System Architecture

```
  ┌─────────────────────────────────────────────────────────────┐
  │                   presenced Daemon (Brain)                  │
  │  • Sources: Niri IPC · MPRIS · LRCLIB · Linux /proc         │
  │  • Engines: Scene Resolver · Pomodoro · Milestone Countdown │
  │  • Auth: $XDG_RUNTIME_DIR/presenced.token (0600 mode)       │
  └───────────────┬─────────────────────────────┬───────────────┘
                  │ WebSocket/HTTP (4242)       │ Local IPC Socket
                  ▼                             ▼
  ┌───────────────────────────────┐   ┌─────────────────────────┐
  │  Desktop Companion (Popup)    │   │  Discord Rich Presence  │
  │  • Tauri v2 · React 19 · CSS  │   │  • Safe RPC Templates   │
  │  • 3-Line Focused Lyrics      │   │  • Rate-limited framing │
  │  • Interactive Pomo Controls  │   │  • Privacy Masking      │
  │  • Slide-Over Settings Drawer │   └─────────────────────────┘
  └───────────────────────────────┘
```

---

## 📖 Step-by-Step Build Tutorial

### 1. Install System Dependencies

#### Arch Linux / CachyOS / Manjaro

```bash
sudo pacman -S --needed \
  nodejs \
  npm \
  pnpm \
  rust \
  cargo \
  base-devel \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  playerctl
```

#### Fedora (40+)

```bash
sudo dnf install \
  nodejs \
  npm \
  pnpm \
  rust \
  cargo \
  gcc-c++ \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  playerctl
```

#### Ubuntu / Debian (24.04+)

```bash
sudo apt update && sudo apt install -y \
  nodejs \
  npm \
  cargo \
  rustc \
  build-essential \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  playerctl

# Install pnpm globally
sudo npm install -g pnpm
```

---

### 2. Clone and Bootstrap the Monorepo

```bash
# Clone the repository
git clone https://github.com/NirussVn0/presenced-popup-niri.git
cd presenced-popup-niri

# Install all workspace dependencies
pnpm install

# Build all packages and applications (contracts, core, daemon, popup, web)
pnpm build
```

---

### 3. Run in Development Mode

Run the background daemon in one terminal:

```bash
pnpm daemon:dev
```

Launch the companion popup in a second terminal:

```bash
pnpm popup:dev
```

---

### 4. Build Production Binaries

```bash
# Build production daemon & web assets
pnpm --filter @presenced/daemon build
pnpm --filter @presenced/web build

# Build production Tauri desktop popup
pnpm --filter @presenced/popup build
cd apps/popup/src-tauri
cargo build --release
```

The compiled companion binary will be available at `apps/popup/src-tauri/target/release/presenced-popup`.

---

## ⚙️ systemd Service Installation

To run `presenced` automatically with your desktop graphical session:

```bash
# Create user systemd directory
mkdir -p ~/.config/systemd/user

# Copy service unit
cp systemd/presenced.service ~/.config/systemd/user/

# Reload systemd and start daemon
systemctl --user daemon-reload
systemctl --user enable --now presenced.service

# Check service status & live logs
systemctl --user status presenced.service
journalctl --user -u presenced.service -f
```

---

## 🖥️ Niri Wayland Integration

`./scripts/install.sh` installs and validates `~/.config/niri/config.d/85-presenced-popup-niri.kdl`, then includes it from `config.kdl`. The rule forces the real runtime app ID into Niri's floating layer at 720×420. After mapping, the Rust startup code resolves its Niri window ID from the process PID and calls `niri msg action center-window --id …`, making centering deterministic across outputs and workspaces.

Only the optional hotkey needs to be added manually:

```kdl
// Keybinding to launch or toggle the companion popup
binds {
    Mod+P { spawn "presenced-popup-niri"; }
}
```

The installed compositor rule is:

```kdl
window-rule {
    match app-id="^presenced-popup-niri$"
    open-floating true
    open-focused true
    default-column-width { fixed 720; }
    default-window-height { fixed 420; }
}
```

---

## 🎭 Scene Profiles &amp; Priority Matrix


| Scene         | Trigger / Mode   | Discord Details                   | Discord State                               |
| :------------- | :---------------- | :--------------------------------- | :------------------------------------------- |
| **Auto**      | Default resolver | Context-dependent                 | Context-dependent                           |
| **Music**     | MPRIS playing    | `{track} - {artist}`              | `{lyric}` (Synced lyrics)                   |
| **Focus**     | Deep work mode   | `{app}`                           | `{title}`                                   |
| **Pomodoro**  | Active timer     | `Focus: {pomodoro.task}`          | `{pomodoro.remaining} left`                 |
| **Countdown** | Milestone target | `{countdown.title}`               | `{countdown.days}d {countdown.hours}h left` |
| **System**    | Telemetry mode   | `{hostname} (CPU: {system.cpu}%)` | `RAM: {system.ram}%`                        |
| **Privacy**   | Hidden titles    | `Using Linux Desktop`             | `Focusing`                                  |


---

## 🧪 Testing &amp; Quality Gates

The project maintains strict TypeScript typings and unit/integration test coverage:

```bash
# Run all Vitest suites (110 tests across 36 files)
pnpm test

# Run strict TypeScript typechecking
pnpm typecheck

# Run linter and code style check
pnpm lint
```

---

## 📁 Monorepo Workspace Structure

```text
presenced-popup-niri/
├── apps/
│   ├── daemon/          # Headless backend (Niri, MPRIS, LRCLIB, SQLite, Discord RPC, Hono)
│   ├── popup/           # Desktop companion (Tauri v2, React 19, Tailwind CSS)
│   └── web/             # Web dashboard & diagnostics
├── packages/
│   ├── contracts/       # Zod schemas & TypeScript definitions
│   └── core/            # Scene resolver, template engine, sanitizer & LRC parser
├── systemd/             # Systemd user service unit & XDG desktop entry
└── docs/                # Architecture, UX, privacy, and research specifications
```

---

## 📄 License

MIT © [NirussVn0](https://github.com/NirussVn0)