import { Button, Group, Paper, Stack, Text, ThemeIcon, Title, VisuallyHidden } from '@mantine/core'
import { IconPhotoUp, IconScan } from '@tabler/icons-react'
import { ReceiptCamera } from './ReceiptCamera'

type CaptureStepProps = {
  statusText: string
  onCapture: (dataUri: string) => void
  onUpload: (file: File | null) => void
  onCameraError: (error: Error) => void
}

export function CaptureStep({ statusText, onCapture, onUpload, onCameraError }: CaptureStepProps) {
  return (
    <Paper
      component="section"
      className="screen-card capture-screen"
      shadow="none"
      aria-label="Capture receipt"
    >
      <Group className="mobile-top" align="flex-start" gap="sm" wrap="nowrap">
        <ThemeIcon className="step-dot" color="receiptRed" radius="xl" size={34}>
          <IconScan size={18} />
        </ThemeIcon>
        <Stack gap={2}>
          <Text className="step-kicker">Scan receipt</Text>
          <Title style={{ marginTop: '-5px' }} order={5}>
            Place the receipt in frame
          </Title>
        </Stack>
      </Group>

      <div className="phone-camera-frame">
        <ReceiptCamera onCapture={onCapture} onError={onCameraError} />
        <div className="scan-guides" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <Stack py={'sm'}>
        <Text c="dimmed">{statusText}</Text>
        <Button
          component="label"
          variant="light"
          color="receiptRed"
          leftSection={<IconPhotoUp size={18} />}
          className="soft-action"
        >
          Upload instead
          <VisuallyHidden>
            <input
              data-testid="receipt-upload"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => onUpload(event.target.files?.[0] ?? null)}
            />
          </VisuallyHidden>
        </Button>
      </Stack>
    </Paper>
  )
}
