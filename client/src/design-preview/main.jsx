import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyAppearance } from '@/lib/appearance';
import { applyBrand, DEFAULT_BRAND } from '@/lib/brand';
import { Preview } from './Preview';
import './preview.css';

applyAppearance('light');
applyBrand(DEFAULT_BRAND);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
