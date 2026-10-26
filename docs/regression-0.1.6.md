# 0.1.6 Regression Record

Date: 2026-10-26. Windows 11 build 26200, Electron 33.4.11, xterm 5.5.0, node-pty 1.1.0.

## Fixes

- Closing search restores the active session's local draft focus.
- Closing the last terminal during rename releases rename handlers and removes the tab.
- Closing all terminals hides search and resets the status bar.
- Open settings follow their anchor when the window changes size.

Each case has a renderer regression test. Changes stay within the owning components and the existing event bus.

## Verification

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed |
| Automated suite | 77 checks passed: 6 startup-cache checks and 71 Electron/native checks |
| Production build and x64 NSIS package | Passed |
| Final EXE workflow | 12 checks passed, including second launch, isolated windows, 13 tabs, workspace paths with Chinese/spaces/apostrophes, invalid paths, undo/redo, search/help focus, draft submission, settings, final-tab close, and surviving-window input |
| Shells | PowerShell 7, Windows PowerShell, and CMD accepted commands in the selected working directory |
| Layout | Four window sizes and multiple draft heights; font-slider drag and window resizing preserved historical scroll position; ConPTY and renderer dimensions agreed |
| Actual Codex CLI history picker | 400 synthetic turns and more than 7,000 rows; thumb resized, dragging reached the beginning, and track clicking reached the middle |
| Actual EXE shutdown | Exit code 0; no uncaught renderer errors during the workflow |

The native test driver allows ConPTY's one-second output-drain timer to finish before quitting. Immediate test-process teardown had intermittently failed after all assertions completed.

Tests used isolated profiles and synthetic conversation history. No real model request was sent. Live provider availability, mixed-DPI multi-monitor moves, and installing through the NSIS wizard were not exercised.

Artifacts: `dist/release-0.1.6/SparkTerminal Setup 0.1.6.exe` and `dist/release-0.1.6/win-unpacked/`.
