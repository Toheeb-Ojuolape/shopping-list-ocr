import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
import './App.css'
import { AppComponent } from './AppComponent'
import { theme } from './theme'

function App() {
  return (
    <MantineProvider theme={theme}>
      <AppComponent />
    </MantineProvider>
  )
}

export default App
