import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Find the 'root' element in your public/index.html file
const root = ReactDOM.createRoot(document.getElementById('root'));

// Render the main App component inside the root element
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
