// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/profile/stylist', title: 'Stylist', tab: 'profile', roles: ['user'], render: placeholder('Stylist') },
  { path: '/profile/stylist/:id', title: 'Stylist request', tab: 'profile', roles: ['user'], render: placeholder('Stylist request') },
];
