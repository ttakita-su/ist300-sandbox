// PLACEHOLDER: replaced by the screen agent that owns this file.
import { html } from '../lib/html.js';
import { emptyState } from '../ui/components.js';

const placeholder = (title) => () => html`${emptyState({ iconName: 'info', title, body: 'This screen is still being built.' })}`;

export default [
  { path: '/profile', title: 'Profile', tab: 'profile', roles: ['user'], render: placeholder('Profile') },
  { path: '/profile/preferences', title: 'Preferences', tab: 'profile', roles: ['user'], render: placeholder('Preferences') },
  { path: '/profile/feedback', title: 'Your feedback', tab: 'profile', roles: ['user'], render: placeholder('Your feedback') },
  { path: '/profile/privacy', title: 'Privacy and data', tab: 'profile', roles: ['user'], render: placeholder('Privacy and data') },
];
