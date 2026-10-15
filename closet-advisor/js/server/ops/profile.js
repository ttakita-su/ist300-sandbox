// Profile and preferences: sizes, budgets, style, colors. Used for cold-start recommendations.
import { invalid } from '../errors.js';
import { defaultProfile } from '../records.js';
import { CATEGORIES, STYLE_TAGS, INTENDED_USES, ALPHA_SIZES, validateSize } from '../../data/schema.js';
import { PICKABLE_COLORS } from '../../data/colors.js';

const subset = (values, allowed) => Array.isArray(values) && values.every((v) => allowed.includes(v));

/** Validates a profile patch and returns the merged profile. Throws invalid() with field errors. */
export function applyProfilePatch(profile, patch) {
  const errors = {};
  const next = structuredClone(profile);

  if (patch.sizes) {
    const sizes = { ...next.sizes };
    for (const [slot, category] of [['shoe', 'sneaker'], ['top', 'clothing'], ['bottom', 'clothing']]) {
      if (!(slot in patch.sizes)) continue;
      const value = patch.sizes[slot];
      if (value == null || !value.value) {
        delete sizes[slot];
        continue;
      }
      const err = validateSize(value, category);
      if (err) errors[`sizes.${slot}`] = err;
      else if (slot === 'top' && (value.system !== 'ALPHA' || !ALPHA_SIZES.includes(value.value))) errors['sizes.top'] = 'Choose a size from XS to XXL';
      else if (slot === 'bottom' && value.system !== 'WAIST-INSEAM') errors['sizes.bottom'] = 'Use waist x inseam, like 32x32';
      else if (slot === 'shoe' && !['US-M', 'US-W'].includes(value.system)) errors['sizes.shoe'] = 'Use a US shoe size';
      else sizes[slot] = { value: String(value.value), system: value.system };
    }
    next.sizes = sizes;
  }

  if (patch.budgets) {
    const budgets = { ...next.budgets };
    for (const category of CATEGORIES) {
      if (!(category in patch.budgets)) continue;
      const v = patch.budgets[category];
      if (v == null || v === '') delete budgets[category];
      else if (!Number.isInteger(v) || v <= 0) errors[`budgets.${category}`] = 'Enter a budget above zero';
      else budgets[category] = v;
    }
    next.budgets = budgets;
  }

  if ('styles' in patch) {
    if (!subset(patch.styles, STYLE_TAGS)) errors.styles = 'Choose styles from the list';
    else next.styles = [...new Set(patch.styles)].slice(0, 6);
  }
  if ('colorsLiked' in patch) {
    if (!subset(patch.colorsLiked, PICKABLE_COLORS)) errors.colorsLiked = 'Choose colors from the list';
    else next.colorsLiked = [...new Set(patch.colorsLiked)];
  }
  if ('colorsAvoided' in patch) {
    if (!subset(patch.colorsAvoided, PICKABLE_COLORS)) errors.colorsAvoided = 'Choose colors from the list';
    else next.colorsAvoided = [...new Set(patch.colorsAvoided)];
  }
  const overlap = next.colorsLiked.filter((c) => next.colorsAvoided.includes(c));
  if (overlap.length) errors.colorsAvoided = 'A color cannot be both liked and avoided';

  if ('uses' in patch) {
    if (!subset(patch.uses, INTENDED_USES)) errors.uses = 'Choose uses from the list';
    else next.uses = [...new Set(patch.uses)];
  }
  if ('categories' in patch) {
    if (!subset(patch.categories, CATEGORIES) || !patch.categories.length) errors.categories = 'Choose at least one category';
    else next.categories = [...new Set(patch.categories)];
  }
  if ('theme' in patch) {
    if (!['system', 'light', 'dark'].includes(patch.theme)) errors.theme = 'Choose a theme';
    else next.theme = patch.theme;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return next;
}

async function loadProfile(ctx) {
  return (await ctx.db.get('profiles', ctx.actor.id)) ?? defaultProfile(ctx.actor.id);
}

export const ops = {
  getProfile: {
    auth: 'user',
    async run(ctx) {
      return loadProfile(ctx);
    },
  },

  /** args: partial profile (sizes, budgets, styles, colorsLiked, colorsAvoided, uses, categories, theme). */
  updateProfile: {
    auth: 'user',
    async run(ctx, patch) {
      const next = applyProfilePatch(await loadProfile(ctx), patch ?? {});
      await ctx.db.put('profiles', next);
      return next;
    },
  },

  /** args: same as updateProfile; also marks onboarding complete. */
  completeOnboarding: {
    auth: 'user',
    async run(ctx, patch) {
      const next = applyProfilePatch(await loadProfile(ctx), patch ?? {});
      next.onboardedAt = ctx.iso();
      await ctx.db.put('profiles', next);
      await ctx.metric('onboarding_completed', { styles: next.styles.length, categories: next.categories.length });
      return next;
    },
  },
};
