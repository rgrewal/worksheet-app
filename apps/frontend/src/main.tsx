import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import WorksheetForm from './WorksheetForm'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorksheetForm />
  </StrictMode>
)
