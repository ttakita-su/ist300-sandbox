// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/wishlist', title: 'Wishlist', tab: 'wishlist', roles: ['user'], render: placeholder('Wishlist') },
  { path: '/wishlist/compare', title: 'Help me choose', tab: 'wishlist', roles: ['user'], render: placeholder('Help me choose') },
  { path: '/wishlist/:id', title: 'Wishlist item', tab: 'wishlist', roles: ['user'], render: placeholder('Wishlist item') },
];
