import { createTheme } from '@mantine/core'
import { brandColor } from './lib/utils'

const sfProFont =
  "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

export const theme = createTheme({
  primaryColor: 'receiptRed',
  colors: {
    receiptRed: [
      '#fff0ef',
      '#ffe0df',
      '#ffc3c0',
      '#ffa29f',
      '#ff8581',
      brandColor,
      '#f5534f',
      '#d9413d',
      '#b93431',
      '#992d2a',
    ],
  },
  defaultRadius: 'md',
  fontFamily: sfProFont,
  headings: {
    fontFamily: sfProFont,
  },
  components: {
    Button: {
      defaultProps: {
        radius: 'lg',
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'lg',
      },
    },
    NumberInput: {
      defaultProps: {
        radius: 'lg',
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: 'xl',
      },
    },
  },
})
