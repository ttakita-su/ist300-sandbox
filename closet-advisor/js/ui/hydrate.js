// Fills <img data-photo-id> with short-lived URLs for private photos. Called after every
// render and by sheets that show photos.
import { api } from '../client.js';

export async function hydratePhotos(root) {
  const images = root.querySelectorAll('img[data-photo-id]:not([data-hydrated])');
  await Promise.all(
    [...images].map(async (img) => {
      img.dataset.hydrated = 'pending';
      try {
        const { url } = await api.getPhotoUrl({ photoId: img.dataset.photoId });
        img.src = url;
        img.dataset.hydrated = 'yes';
      } catch {
        // The photo was deleted or access ended: show the neutral tile instead of a broken image.
        img.dataset.hydrated = 'failed';
        img.removeAttribute('src');
        img.style.visibility = 'hidden';
      }
    }),
  );
}
