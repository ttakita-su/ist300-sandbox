// Every screen module. Order matters only where two patterns could match the same path:
// static segments (/wishlist/compare) are listed before parameters (/wishlist/:id).
import welcome from './welcome.js';
import onboarding from './onboarding.js';
import profile from './profile.js';
import stylistShare from './stylist-share.js';
import add from './add.js';
import capture from './capture.js';
import match from './match.js';
import collection from './collection.js';
import wishlist from './wishlist.js';
import discover from './discover.js';
import product from './product.js';
import go from './go.js';
import stylist from './stylist.js';
import admin from './admin.js';

export default [
  ...welcome,
  ...onboarding,
  ...profile,
  ...stylistShare,
  ...add,
  ...capture,
  ...match,
  ...collection,
  ...wishlist,
  ...discover,
  ...product,
  ...go,
  ...stylist,
  ...admin,
];
