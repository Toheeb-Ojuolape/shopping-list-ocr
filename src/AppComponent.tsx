import { Badge, Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconReceipt, IconRefresh } from "@tabler/icons-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CaptureStep } from "./components/CaptureStep";
import { LoadingStep } from "./components/LoadingStep";
import { ReviewStep } from "./components/ReviewStep";
import { refineReceiptWithGemini } from "./lib/gemini";
import {
  appendReceiptToGoogleSheet,
  downloadReceiptCsv,
} from "./lib/googleSheets";
import { recognizeReceiptImage } from "./lib/ocr";
import type { ReceiptExtraction, ReceiptItem } from "./lib/receipt";
import { parseReceiptText, sumItems } from "./lib/receipt";
import {
  getEnvGeminiKey,
  getSavedSheetSettings,
  saveSheetSettings,
  toReadableStatus,
} from "./lib/utils";

type AppStep = "capture" | "review";
type WorkStatus =
  | "idle"
  | "recognizing"
  | "refining"
  | "ready"
  | "saving"
  | "error";

const envGeminiKey = getEnvGeminiKey();
const savedSheetSettings = getSavedSheetSettings();

export function AppComponent() {
  const [step, setStep] = useState<AppStep>("capture");
  const [status, setStatus] = useState<WorkStatus>("idle");
  const [statusText, setStatusText] = useState("Ready when you are");
  const [progress, setProgress] = useState(0);
  const [extraction, setExtraction] = useState<ReceiptExtraction | undefined>();
  const activeReceiptIdRef = useRef<string | undefined>(undefined);
  const [sheetEndpoint, setSheetEndpoint] = useState(
    savedSheetSettings.endpointUrl
  );
  const [sheetName, setSheetName] = useState(savedSheetSettings.sheetName);

  const lineTotal = useMemo(
    () => sumItems(extraction?.items ?? []),
    [extraction]
  );
  const isExtracting = status === "recognizing" || status === "refining";
  const isSaving = status === "saving";

  function maybeRefineWeakExtraction(
    rawText: string,
    fallback: ReceiptExtraction
  ) {
    if (!envGeminiKey.trim() || !shouldRefineWithGemini(fallback)) {
      return;
    }

    void refineReceiptWithGemini(envGeminiKey, rawText, fallback)
      .then((refined) => {
        if (
          activeReceiptIdRef.current !== fallback.receiptId ||
          refined.items.length < fallback.items.length
        ) {
          return;
        }

        let appliedStatus: string | undefined;
        setExtraction((current) => {
          if (
            !current ||
            current.receiptId !== fallback.receiptId ||
            current.items.length !== fallback.items.length
          ) {
            return current;
          }

          appliedStatus = getReadyStatusText(refined);
          return refined;
        });

        if (appliedStatus) {
          setStatus("ready");
          setStatusText(appliedStatus);
        }
      })
      .catch(() => {
        // Keep the local OCR result visible; Gemini is only a best-effort fallback.
      });
  }

  const extractReceipt = useCallback(async (imageDataUri: string) => {
    setStep("review");
    setExtraction(undefined);
    setStatus("recognizing");
    setStatusText("Reading your receipt");
    setProgress(8);

    try {
      const ocr = await recognizeReceiptImage(imageDataUri, (nextProgress) => {
        setProgress(nextProgress.progress);
        setStatusText(toReadableStatus(nextProgress.status));
      });

      const parsed = parseReceiptText(ocr.text, { defaultCurrency: "GBP" });
      activeReceiptIdRef.current = parsed.receiptId;

      setStatus("ready");
      setStatusText(getReadyStatusText(parsed));
      setExtraction(parsed);
      setProgress(100);

      maybeRefineWeakExtraction(ocr.text, parsed);
    } catch (error) {
      setStatus("error");
      setStatusText(
        error instanceof Error ? error.message : "Receipt extraction failed"
      );
    }
  }, []);

  const handleCameraError = useCallback((error: Error) => {
    setStatus("error");
    setStatusText(error.message);
  }, []);

  function handleUpload(file: File | null) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      void extractReceipt(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveToSheet() {
    if (!extraction) return;

    setStatus("saving");
    setStatusText("Saving to Google Sheet");

    try {
      await appendReceiptToGoogleSheet(
        {
          endpointUrl: sheetEndpoint,
          sheetName,
        },
        extraction
      );
      saveSheetSettings({ endpointUrl: sheetEndpoint, sheetName });
      setStatus("ready");
      setStatusText("Saved to Google Sheet");
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Save failed");
    }
  }

  function updateReceipt(patch: Partial<ReceiptExtraction>) {
    setExtraction((current) => (current ? { ...current, ...patch } : current));
  }

  function updateItem(id: string, patch: Partial<ReceiptItem>) {
    setExtraction((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      };
    });
  }

  function addItem() {
    setExtraction((current) => {
      if (!current) return current;
      const item: ReceiptItem = {
        id: `manual-${Date.now()}`,
        name: "New item",
        quantity: 1,
        totalPrice: 0,
        currency: current.currency,
        confidence: 1,
      };

      return { ...current, items: [...current.items, item] };
    });
  }

  function removeItem(id: string) {
    setExtraction((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.filter((item) => item.id !== id),
      };
    });
  }

  function startNewReceipt() {
    setStep("capture");
    setExtraction(undefined);
    activeReceiptIdRef.current = undefined;
    setProgress(0);
    setStatus("idle");
    setStatusText("Ready when you are");
  }

  return (
    <Box component="main" className="receipt-app">
      <Paper component="div" className="app-shell" shadow="xl" radius={34}>
        <Group
          component="header"
          className="app-status"
          justify="space-between"
          wrap="nowrap"
        >
          <Badge
            className="brand-mark"
            p={0}
            radius="md"
            color="receiptRed"
            aria-label="Receipt app"
          >
            <IconReceipt size={16} />
          </Badge>
          <Badge
            className={`status-chip ${status}`}
            data-testid="receipt-status"
            color={
              status === "error"
                ? "red"
                : status === "ready"
                ? "green"
                : "receiptRed"
            }
            variant="light"
            fw={"bold"}
          >
            {statusText}
          </Badge>
        </Group>

        {step === "capture" && (
          <CaptureStep
            statusText={statusText}
            onCapture={(dataUri) => void extractReceipt(dataUri)}
            onUpload={handleUpload}
            onCameraError={handleCameraError}
          />
        )}

        {step === "review" && isExtracting && (
          <LoadingStep statusText={statusText} progress={progress} />
        )}

        {step === "review" && !isExtracting && extraction && (
          <ReviewStep
            extraction={extraction}
            lineTotal={lineTotal}
            statusText={statusText}
            isSaving={isSaving}
            sheetEndpoint={sheetEndpoint}
            sheetName={sheetName}
            onNewReceipt={startNewReceipt}
            onUpdateReceipt={updateReceipt}
            onUpdateItem={updateItem}
            onAddItem={addItem}
            onRemoveItem={removeItem}
            onSheetEndpointChange={setSheetEndpoint}
            onSheetNameChange={setSheetName}
            onSaveToSheet={() => void handleSaveToSheet()}
            onDownloadCsv={() => downloadReceiptCsv(extraction)}
          />
        )}

        {step === "review" && !isExtracting && !extraction && (
          <Paper
            component="section"
            className="screen-card empty-review"
            shadow="none"
          >
            <Text component="h1" fw={900}>
              We could not read that one
            </Text>
            <Text c="dimmed">{statusText}</Text>
            <Button
              leftSection={<IconRefresh size={18} />}
              onClick={startNewReceipt}
            >
              Try again
            </Button>
          </Paper>
        )}
      </Paper>
    </Box>
  );
}

function getReadyStatusText(extraction: ReceiptExtraction): string {
  if (extraction.items.length === 0) {
    return "No rows found";
  }

  return `${extraction.items.length} rows ready`;
}

function shouldRefineWithGemini(extraction: ReceiptExtraction): boolean {
  if (extraction.items.length === 0) {
    return true;
  }

  const averageConfidence =
    extraction.items.reduce((total, item) => total + item.confidence, 0) /
    extraction.items.length;

  return averageConfidence < 0.72;
}
