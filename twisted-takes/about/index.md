---
title: "About Twisted Takes"
permalink: /about/
description: "Who we are, why Twisted Takes exists, how the blog connects to our social channels, how we handle spoilers and how our optional 1–5 ratings work."
lede: "A student team that reviews movies and TV, argues about them in good faith and wants to help you find your next watch."
---

## What we do

Twisted Takes reviews and discusses movies and TV across several genres. We launched with five: [Sci-Fi]({{ '/genres/sci-fi/' | relative_url }}), [True Crime]({{ '/genres/true-crime/' | relative_url }}), [Fantasy]({{ '/genres/fantasy/' | relative_url }}), [Rom-Com]({{ '/genres/rom-com/' | relative_url }}) and [Horror]({{ '/genres/horror/' | relative_url }}). Movies came first; TV reviews will join the same genre pages.

Our goal is simple: help people discover entertainment worth their time, and put different opinions side by side so you can decide for yourself.

## Why we started

We share an interest in entertainment, and in the conversations it starts: the group chat after a finale, the friend who will not stop recommending one film, the argument over whether an ending worked. Twisted Takes gives those conversations a home.

## Why “Twisted”?

“Twisted” is about perspective. We like looking at a familiar title from a different angle, and we like recommendations you might not expect: the documentary that plays like a thriller, the animated film for people who “don’t do” animation.

## How the blog fits with our channels

Our Instagram, TikTok and YouTube channels carry the short videos and visuals. This blog adds the detail those formats leave out: longer reviews, genre hubs, [Watch Next]({{ '/watch-next/' | relative_url }}) recommendation collections and discussion prompts you can take back to the comments.

## Opinions, disagreement and spoilers

Every review is an opinion. You may love a film we found frustrating, and that is the point. Disagree with us respectfully, and talk about the work rather than the people watching it.

Reviews are spoiler-free unless they say otherwise. When a review needs to discuss an ending or a twist, that section is clearly labeled and stays hidden until you choose to open it.

## Who does what

<ul class="team-list">
{%- for person in site.data.team %}
  <li><span class="team-list__name">{{ person.name }}</span> <span class="team-list__role">{{ person.role }}</span></li>
{%- endfor %}
</ul>

## How our ratings work

Reviews can carry an optional editorial rating from one to five stars. It reflects the Twisted Takes team’s judgment of a title, not an audience vote, and we never borrow scores from other sites.

<dl class="rating-scale">
{%- for level in site.data.rating_scale %}
  <div class="rating-scale__row">
    <dt><span class="rating-scale__stars" aria-hidden="true">{% for i in (1..level.stars) %}★{% endfor %}</span> <span class="rating-scale__label">{{ level.stars }} — {{ level.label }}</span></dt>
    <dd>{{ level.meaning }}</dd>
  </div>
{%- endfor %}
</dl>

Our launch reviews have not been rated yet, so they show “Not yet rated.” A rating appears only once the team has agreed on one.

## About “Sample” labels

Some launch reviews and articles are marked **Sample**. That text was written to get the site started, and the team is still reviewing it. When a piece has been edited and approved as the team’s own opinion, the label comes off.
