import {
  ActionIcon,
  Autocomplete,
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconDownload,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSend,
  IconTrash,
} from '@tabler/icons-react'
import { normalizeMerchantName } from '../lib/ocrCorrection'
import type { ReceiptExtraction, ReceiptItem } from '../lib/receipt'
import { merchantLexicon } from '../lib/receiptLexicon'
import { formatMoney, today, toPositiveNumber } from '../lib/utils'

const fieldClassNames = {
  input: 'field-input',
  label: 'field-label',
}

const darkFieldClassNames = {
  input: 'dark-field-input',
  label: 'dark-field-label',
}

type ReviewStepProps = {
  extraction: ReceiptExtraction
  lineTotal: number
  statusText: string
  isSaving: boolean
  sheetUrl: string
  sheetName: string
  isGoogleConnected: boolean
  hasGoogleClientId: boolean
  onNewReceipt: () => void
  onUpdateReceipt: (patch: Partial<ReceiptExtraction>) => void
  onUpdateItem: (id: string, patch: Partial<ReceiptItem>) => void
  onAddItem: () => void
  onRemoveItem: (id: string) => void
  onSheetUrlChange: (value: string) => void
  onSheetNameChange: (value: string) => void
  onConnectGoogle: () => void
  onSaveToSheet: () => void
  onDownloadCsv: () => void
}

export function ReviewStep({
  extraction,
  lineTotal,
  statusText,
  isSaving,
  sheetUrl,
  sheetName,
  isGoogleConnected,
  hasGoogleClientId,
  onNewReceipt,
  onUpdateReceipt,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
  onSheetUrlChange,
  onSheetNameChange,
  onConnectGoogle,
  onSaveToSheet,
  onDownloadCsv,
}: ReviewStepProps) {
  const receiptTotal = extraction.total ?? lineTotal
  const date = extraction.purchasedAt ?? today

  return (
    <Stack component="section" className="review-screen" aria-label="Review receipt" gap="sm">
      <Group className="review-hero" justify="space-between" align="center" wrap="nowrap">
        <Stack gap={2}>
          <Text className="step-label">Step 2</Text>
          <Title order={1}>Check your items</Title>
        </Stack>
        <Button
          variant="light"
          color="receiptRed"
          leftSection={<IconRefresh size={17} />}
          className="round-action"
          onClick={onNewReceipt}
          fw={'bold'}
        >
          New
        </Button>
      </Group>

      <Paper className="total-card" shadow="lg">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text>Total</Text>
            <Title order={2}>{formatMoney(receiptTotal, extraction.currency)}</Title>
            <Text>
              {extraction.items.length} {extraction.items.length === 1 ? 'item' : 'items'} found
            </Text>
          </Stack>
          <IconReceipt size={30} stroke={1.8} />
        </Group>
      </Paper>

      <SimpleGrid className="mini-fields" cols={2} spacing="sm">
        <Autocomplete
          label="Store"
          classNames={fieldClassNames}
          data={merchantLexicon}
          limit={8}
          maxDropdownHeight={220}
          value={extraction.merchant}
          onChange={(value) => onUpdateReceipt({ merchant: value })}
          onBlur={() => {
            const inferred = normalizeMerchantName(extraction.merchant)
            onUpdateReceipt({ merchant: inferred.value })
          }}
        />
        <TextInput
          label="Date"
          classNames={fieldClassNames}
          type="date"
          value={date}
          onChange={(event) => onUpdateReceipt({ purchasedAt: event.target.value })}
        />
      </SimpleGrid>

      <ItemList items={extraction.items} onUpdateItem={onUpdateItem} onRemoveItem={onRemoveItem} />

      <Button
        variant="light"
        color="receiptRed"
        leftSection={<IconPlus size={18} />}
        className="add-row-button"
        onClick={onAddItem}
      >
        Add missing item
      </Button>

      <SavePanel
        statusText={statusText}
        isSaving={isSaving}
        sheetUrl={sheetUrl}
        sheetName={sheetName}
        isGoogleConnected={isGoogleConnected}
        hasGoogleClientId={hasGoogleClientId}
        onSheetUrlChange={onSheetUrlChange}
        onSheetNameChange={onSheetNameChange}
        onConnectGoogle={onConnectGoogle}
        onSaveToSheet={onSaveToSheet}
        onDownloadCsv={onDownloadCsv}
      />
    </Stack>
  )
}

function ItemList({
  items,
  onUpdateItem,
  onRemoveItem,
}: {
  items: ReceiptItem[]
  onUpdateItem: (id: string, patch: Partial<ReceiptItem>) => void
  onRemoveItem: (id: string) => void
}) {
  return (
    <Stack aria-label="Extracted items">
      {items.map((item) => (
        <Paper className="native-row" data-testid="item-row" key={item.id} shadow="sm">
          <TextInput
            label="Item"
            classNames={fieldClassNames}
            className="item-title-field"
            value={item.name}
            onChange={(event) => onUpdateItem(item.id, { name: event.target.value })}
          />
          <SimpleGrid className="price-pair" cols={2} spacing="sm">
            <NumberInput
              label="Qty"
              classNames={fieldClassNames}
              min={0}
              value={item.quantity}
              onChange={(value) => onUpdateItem(item.id, { quantity: toPositiveNumber(value, 1) })}
            />
            <NumberInput
              label="Price"
              classNames={fieldClassNames}
              min={0}
              decimalScale={2}
              value={item.totalPrice}
              onChange={(value) =>
                onUpdateItem(item.id, { totalPrice: toPositiveNumber(value, 0) })
              }
            />
          </SimpleGrid>
          <ActionIcon
            variant="subtle"
            color="gray"
            className="remove-row"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemoveItem(item.id)}
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Paper>
      ))}
    </Stack>
  )
}

function SavePanel({
  statusText,
  isSaving,
  sheetUrl,
  sheetName,
  onSheetUrlChange,
  onSheetNameChange,
  onSaveToSheet,
  onDownloadCsv,
}: {
  statusText: string
  isSaving: boolean
  sheetUrl: string
  sheetName: string
  isGoogleConnected: boolean
  hasGoogleClientId: boolean
  onSheetUrlChange: (value: string) => void
  onSheetNameChange: (value: string) => void
  onConnectGoogle: () => void
  onSaveToSheet: () => void
  onDownloadCsv: () => void
}) {
  return (
    <Paper component="section" className="save-card" aria-label="Save receipt" shadow="md">
      <Stack gap="sm">
        <Stack gap={2}>
          <Text className="step-label">Finish</Text>
          <Title c={'white'} order={2}>
            Save your receipt data
          </Title>
        </Stack>

        <Stack>
          <TextInput
            label="Google Sheet link"
            classNames={darkFieldClassNames}
            value={sheetUrl}
            onChange={(event) => onSheetUrlChange(event.target.value)}
            placeholder="Paste your docs.google.com Sheet link"
          />
          <TextInput
            label="Sheet tab"
            classNames={darkFieldClassNames}
            value={sheetName}
            onChange={(event) => onSheetNameChange(event.target.value)}
          />
        </Stack>

        {/* {!isGoogleConnected && (
          <Button
            variant="light"
            color={isGoogleConnected ? 'green' : 'receiptRed'}
            leftSection={<IconSend size={18} />}
            className="secondary-button"
            disabled={!hasGoogleClientId || isGoogleConnected}
            onClick={onConnectGoogle}
          >
            Connect Your Google
          </Button>
        )} */}
        <Button
          loading={isSaving}
          leftSection={<IconSend size={18} />}
          className="primary-button"
          onClick={onSaveToSheet}
        >
          Save to Google Sheet
        </Button>
        <Button
          variant="subtle"
          leftSection={<IconDownload size={18} />}
          className="secondary-button"
          onClick={onDownloadCsv}
        >
          Download CSV
        </Button>

        <Text className="save-status">{statusText}</Text>
      </Stack>
    </Paper>
  )
}
