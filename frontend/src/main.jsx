import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
// Importado antes de tudo: aplica a classe dark/light no <html> no momento
// em que o módulo carrega (efeito de import), evitando "flash" de light
// mode antes do React montar.
import './store/themeStore.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);