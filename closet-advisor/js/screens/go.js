// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/go/:offerId', title: 'Leaving Rotation', tab: null, roles: ['user', 'stylist'], render: placeholder('Leaving Rotation') },
];
