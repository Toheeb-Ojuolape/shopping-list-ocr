import { mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, {
  test: {
    include: ['src/**/*.integration.test.{ts,tsx}'],
  },
})
