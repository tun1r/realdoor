import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/newsreader/latin-400.css'
import '@fontsource/newsreader/latin-500.css'
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/instrument-sans/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './index.css'
import './App.css'
import App from './App.tsx'
import { TechVideo } from './TechVideo.tsx'
import './tech-video.css'

const isTechVideo = window.location.pathname === '/tech-video'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTechVideo ? <TechVideo /> : <App />}
  </StrictMode>,
)
