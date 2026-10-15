// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/admin', title: 'Admin', tab: null, roles: ['admin'], render: placeholder('Admin') },
  { path: '/admin/:section', title: 'Admin', tab: null, roles: ['admin'], render: placeholder('Admin') },
];
