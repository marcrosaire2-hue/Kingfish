"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { parseQrIdFromScan } from "@/lib/parse-qr-id";

type QrScannerProps = {
  active: boolean;
  onDetected: (qrId: string) => void;
  /** Masque l'import photo — vente au comptoir : caméra seulement. */
  cameraOnly?: boolean;
};

export function QrScanner({
  active,
  onDetected,
  cameraOnly = false,
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const onDetectedRef = useRef(onDetected);
  const lastScanRef = useRef<{ id: string; at: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!active) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      setStatus(null);
      return;
    }

    let cancelled = false;
    const reader = new BrowserQRCodeReader();

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus(
            cameraOnly
              ? "Caméra non disponible sur ce navigateur."
              : "Caméra non disponible sur ce navigateur. Utilisez la photo ou la saisie manuelle.",
          );
          return;
        }

        const devices = await BrowserQRCodeReader.listVideoInputDevices();
        if (!devices.length) {
          setStatus("Aucune caméra détectée sur cet appareil.");
          return;
        }

        const preferred =
          devices.find((d) =>
            /back|rear|arrière|environment|facing/i.test(d.label),
          ) ?? devices[devices.length - 1];

        if (!videoRef.current || cancelled) return;

        const controls = await reader.decodeFromVideoDevice(
          preferred.deviceId,
          videoRef.current,
          (result, error) => {
            if (error?.name === "NotFoundException") return;
            if (!result) return;

            const qrId = parseQrIdFromScan(result.getText());
            if (!qrId) return;

            const now = Date.now();
            if (
              lastScanRef.current?.id === qrId &&
              now - lastScanRef.current.at < 2500
            ) {
              return;
            }
            lastScanRef.current = { id: qrId, at: now };
            onDetectedRef.current(qrId);
          },
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setStatus(null);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Accès caméra refusé.";
        setStatus(
          message.includes("Permission")
            ? "Autorisez l'accès à la caméra dans le navigateur."
            : message,
        );
      }
    }

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [active, cameraOnly]);

  async function onFileChange(file: File | null) {
    if (!file) return;
    setFileBusy(true);
    setStatus(null);
    const reader = new BrowserQRCodeReader();
    const url = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(url);
      const qrId = parseQrIdFromScan(result.getText());
      if (!qrId) {
        setStatus("Aucun identifiant KF- reconnu sur l'image.");
        return;
      }
      onDetectedRef.current(qrId);
    } catch {
      setStatus("QR illisible — recadrez la photo ou augmentez la lumière.");
    } finally {
      URL.revokeObjectURL(url);
      setFileBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="qr-scanner">
      {active ? (
        <div className="qr-scanner-live">
          <video
            ref={videoRef}
            className="qr-scanner-video"
            muted
            playsInline
            autoPlay
          />
          <p className="qr-scanner-hint">
            {status ?? "Cadrez le QR dans le cadre — détection automatique."}
          </p>
        </div>
      ) : null}

      {!cameraOnly ? (
        <label className="btn btn-block btn-ghost qr-scanner-file">
          {fileBusy ? "Lecture…" : "Importer une photo du QR"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={fileBusy}
            onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : null}
    </div>
  );
}
