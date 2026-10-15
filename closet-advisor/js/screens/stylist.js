// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/stylist', title: 'Stylist workspace', tab: null, roles: ['stylist'], render: placeholder('Stylist workspace') },
  { path: '/stylist/request/:id', title: 'Client request', tab: null, roles: ['stylist'], render: placeholder('Client request') },
];
