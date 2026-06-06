import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
import './App.css'
import { AppComponent } from './AppComponent'
import { theme } from './theme'
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <MantineProvider theme={theme}>
      <Toaster position="top-right" />
      <AppComponent />
    </MantineProvider>
  )
}

export default App
