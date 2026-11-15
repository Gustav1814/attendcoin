import type QrScannerType from "qr-scanner";
import { Camera, CameraOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import styles from "./Scanner.module.css";

type CameraState = "idle" | "starting" | "scanning" | "denied" | "unavailable" | "error";

export interface ScannerProps {
  /**
   * Called for each decoded code. Return true when the code was accepted so the
   * camera stops; return false to keep scanning.
   */
  onResult: (text: string) => boolean;
  /** Message shown over the viewfinder, e.g. after an unrelated code was read. */
  hint?: string | null;
  /** Start the camera as soon as the component mounts. */
  autoStart?: boolean;
  label?: string;
  className?: string;
}

/**
 * Camera QR reader built on qr-scanner. The library and its worker load only
 * when the camera starts, so pages that never scan don't pay for them.
 */
export function Scanner({ onResult, hint, autoStart = true, label = "QR code scanner", className }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [state, setState] = useState<CameraState>("idle");

  const stop = useCallback(() => {
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setState((s) => (s === "scanning" || s === "starting" ? "idle" : s));
  }, []);

  const start = useCallback(async () => {
    if (!videoRef.current || scannerRef.current) return;
    setState("starting");
    try {
      const { default: QrScanner } = await import("qr-scanner");
      if (!(await QrScanner.hasCamera())) {
        setState("unavailable");
        return;
      }
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          if (onResultRef.current(result.data)) {
            scanner.destroy();
            if (scannerRef.current === scanner) scannerRef.current = null;
            setState("idle");
          }
        },
        { preferredCamera: "environment", maxScansPerSecond: 10, returnDetailedScanResult: true },
      );
      scannerRef.current = scanner;
      await scanner.start();
      setState("scanning");
    } catch (err) {
      scannerRef.current?.destroy();
      scannerRef.current = null;
      const name = (err as { name?: string })?.name;
      const text = String(err);
      if (name === "NotAllowedError" || /permission|denied/i.test(text)) setState("denied");
      else if (name === "NotFoundError" || /not found/i.test(text)) setState("unavailable");
      else setState("error");
    }
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    return () => {
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [autoStart, start]);

  const live = state === "scanning" || state === "starting";
  const message =
    state === "denied"
      ? "Camera access was blocked. Allow it in your browser's site settings, or paste the link below."
      : state === "unavailable"
        ? "No camera was found on this device. Paste the link below instead."
        : state === "error"
          ? "The camera couldn't start. Close other apps using it and try again."
          : state === "starting"
            ? "Starting camera…"
            : state === "scanning"
              ? (hint ?? "Point the camera at the code.")
              : "Camera is off.";

  return (
    <div className={cx(styles.scanner, className)}>
      <div className={cx(styles.viewfinder, live && styles.live)} aria-label={label} role="region">
        <video ref={videoRef} className={styles.video} muted playsInline aria-hidden="true" />
        <span className={styles.corners} aria-hidden="true" />
        {!live && (
          <div className={styles.placeholder}>
            <CameraOff size={28} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className={styles.bar}>
        <p className={cx(styles.message, hint && state === "scanning" && styles.warn)} role="status" aria-live="polite">
          {message}
        </p>
        {live ? (
          <Button size="sm" variant="ghost" onClick={stop}>
            Stop
          </Button>
        ) : (
          state !== "unavailable" && (
            <Button size="sm" variant="secondary" leading={<Camera size={14} aria-hidden="true" />} onClick={() => void start()}>
              {state === "idle" ? "Start camera" : "Try again"}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
