"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, Spinner } from "./ui";

export default function PdfPreview({
  url,
  zoom,
  title,
  highlighted,
}: {
  url: string;
  zoom: number;
  title: string;
  highlighted: boolean;
}) {
  const [state, setState] = useState<{ blob?: string; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => ({
            error: "Preview is unavailable. Try again.",
          }))) as { error?: string };
          throw new Error(data.error || "Preview is unavailable.");
        }
        if (!response.headers.get("Content-Type")?.includes("image/png"))
          throw new Error("The server did not return a document preview.");
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ blob: objectUrl });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ error: (error as Error).message });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, attempt]);
  if (state.error)
    return (
      <div className="empty-state" role="alert">
        <AlertTriangle size={28} />
        <h3>Preview needs attention</h3>
        <p>{state.error}</p>
        <Button
          kind="secondary"
          onClick={() => {
            setState({});
            setAttempt((a) => a + 1);
          }}
        >
          <RotateCcw size={15} /> Retry preview
        </Button>
      </div>
    );
  if (!state.blob)
    return (
      <div className="empty-state" role="status">
        <Spinner />
        <p>
          {highlighted
            ? "Preparing change highlights…"
            : "Loading document preview…"}
        </p>
      </div>
    );
  return (
    <div className="preview-image-scroll">
      <div
        className="preview-image-stage"
        style={{ width: `${zoom}%`, maxWidth: `${(760 * zoom) / 100}px` }}
      >
        {/* The server renders the validated PDF with its annotation appearance streams. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.blob} alt={title} className="preview-page-image" />
      </div>
    </div>
  );
}
