// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/add', title: 'Add an item', tab: null, roles: ['user'], render: placeholder('Add an item') },
  { path: '/add/link', title: 'Add from a link', tab: null, roles: ['user'], render: placeholder('Add from a link') },
  { path: '/add/search', title: 'Search the catalog', tab: null, roles: ['user'], render: placeholder('Search the catalog') },
  { path: '/add/manual', title: 'Add manually', tab: null, roles: ['user'], render: placeholder('Add manually') },
];
