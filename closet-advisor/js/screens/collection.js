// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/collection', title: 'Collection', tab: 'collection', roles: ['user'], render: placeholder('Collection') },
  { path: '/collection/:id', title: 'Item', tab: 'collection', roles: ['user'], render: placeholder('Item') },
  { path: '/collection/:id/edit', title: 'Edit item', tab: 'collection', roles: ['user'], render: placeholder('Edit item') },
];
