import React from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider, createTheme, localStorageColorSchemeManager} from '@mantine/core';
import '@mantine/core/styles.css';
import './page.css';
import {BrowserApp} from './app.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Browser page has no root element');
}
createRoot(root).render(
  <MantineProvider defaultColorScheme="auto" colorSchemeManager={localStorageColorSchemeManager({key: 'genopilot-theme'})} theme={createTheme({primaryColor: 'teal', defaultRadius: 'md', fontFamily: 'system-ui, sans-serif'})}>
    <BrowserApp />
  </MantineProvider>,
);
