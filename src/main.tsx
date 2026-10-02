import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import App from './App.tsx'

// Deliberately no StrictMode: its double-invoked effects would open the
// microphone and arm the wake-word engine twice, and the second subscription
// steals the audio stream from the first.
createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
)
