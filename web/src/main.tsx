import React from 'react'
import ReactDOM from 'react-dom/client'
import '@carbon/styles/css/styles.css'
import './app.scss'
import './i18n/index'
import { brandTitle } from './brand'
import App from './App'

// Keep the browser tab title in sync with the deployment brand (env- or
// file-injected; defaults to "OCM"). Covers builds where the static <title>
// placeholder was defaulted by the vite plugin.
document.title = brandTitle

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
