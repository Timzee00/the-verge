import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';
import { registerTheVergePWA } from './pwa';
void registerTheVergePWA();
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);
