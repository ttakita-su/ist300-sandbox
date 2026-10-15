// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/discover', title: 'Discover', tab: 'discover', roles: ['user'], render: placeholder('Discover') },
  { path: '/recs', title: 'Recommendations', tab: 'discover', roles: ['user'], render: placeholder('Recommendations') },
];
