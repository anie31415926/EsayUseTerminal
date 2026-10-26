/** Renderer compatibility metadata, independent of the shell running inside the PTY. */
export interface PtyCompatibility {
  windowsPty?: { backend: 'conpty'; buildNumber: number }
}
