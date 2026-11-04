import { getStore } from '@netlify/blobs';

export function scope() {
  return Netlify.context?.deploy.context === 'production' ? 'production' : 'preview';
}

export function mediaStore() {
  // New uploads must be readable as soon as they appear in the shared catalog.
  return getStore({
    name: scope() === 'production' ? 'cineverse-media' : 'cineverse-media-preview',
    consistency: 'strong',
  });
}
