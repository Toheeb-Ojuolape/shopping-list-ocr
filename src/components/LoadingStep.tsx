import { Loader, Paper, Progress, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconReportSearch } from '@tabler/icons-react'

type LoadingStepProps = {
  statusText: string
  progress: number
}

export function LoadingStep({ statusText, progress }: LoadingStepProps) {
  return (
    <Paper
      component="section"
      className="screen-card loading-screen"
      shadow="none"
      aria-label="Reading receipt"
    >
      <Stack align="center" gap="sm">
        <ThemeIcon
          className="loading-pulse"
          color="receiptRed"
          variant="light"
          size={78}
          radius={24}
        >
          <IconReportSearch size={34} />
        </ThemeIcon>
        <Text className="loading-kicker">Step 2</Text>
        <Title order={1}>{statusText}</Title>
        <Text className="quiet-copy" c="dimmed">
          Finding items, prices, and totals.
        </Text>
        <Loader color="receiptRed" size="sm" />
        <Progress
          className="loading-bar"
          color="receiptRed"
          value={Math.max(12, progress)}
          aria-label="Extraction progress"
        />
      </Stack>
    </Paper>
  )
}
