import { Badge, Box, Button, Group, Paper, Text } from "@mantine/core";
import {
  IconCancel,
  IconCheck,
  IconReceipt2,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
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

      let parsed = parseReceiptText(ocr.text, { defaultCurrency: "GBP" });

      if (envGeminiKey.trim()) {
        setStatus("refining");
        setStatusText("Tidying up the list");
        parsed = await refineReceiptWithGemini(envGeminiKey, ocr.text, parsed);
      }

      setExtraction(parsed);
      setStatus("ready");
      setStatusText(`${parsed.items.length} rows ready`);
      setProgress(100);
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
            <IconReceipt2 size={20} stroke={2.2} />
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
            {status === "error" ? (
              <IconCancel color={"red"} size={13} />
            ) : (
              <IconCheck color={"green"} size={13} />
            )}{" "}
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
