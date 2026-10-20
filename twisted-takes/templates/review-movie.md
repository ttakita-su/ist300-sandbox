---
# Copy this file to _reviews/<slug>.md, where <slug> is the title in lowercase
# with hyphens (e.g. _reviews/past-lives.md). The page will be /reviews/<slug>/.
# Required fields are marked (required). Unknown optional facts: null, unquoted.
title: "Movie Title"                    # (required) exact title
slug: "movie-title"                     # (required) same as the file name
year: 2024                              # (required) original release year
media_type: "movie"                     # (required) movie | tv
primary_genre: "sci-fi"                 # (required) sci-fi | true-crime | fantasy | rom-com | horror
subgenre: "Short label"                 # e.g. "Space survival"; or null
tags: ["tag-one", "tag-two", "tag-three"]   # 3–6 lowercase, hyphenated; searchable
moods: ["thoughtful", "tense"]          # 2–3 of: thoughtful, mind-bending, tense, eerie, cozy, romantic, funny, adventurous, emotional, unsettling, investigative
headline: "A Descriptive Headline, Not Just the Title"   # (required) no spoilers
excerpt: "One spoiler-free sentence for cards, under 150 characters."   # (required)
description: "Search and social description, 120–155 characters, spoiler-free."   # (required)
image: "/assets/images/covers/movie-title.svg"   # (required) cover path, or a full https:// URL you may use
image_alt: "What the cover image shows, for people who cannot see it."   # (required)
image_credit: "Original cover art by Twisted Takes. Not an official poster."   # (required) who made the image / license
social_image: null                      # optional 1200×630 PNG/JPG for link previews; null uses the site default
director: "Director Name"               # verified only, else null
runtime_minutes: 120                    # verified only, else null
content_rating: "PG-13"                 # US rating, verified only, else null
content_rating_system: "MPA"            # "MPA" (films) | "TV" (US TV rating such as TV-MA) | null
advisory: "Short content advisory in your own words, or null."
score: null                             # editorial rating 1–5 (whole number) once the team agrees; null = "Not yet rated"
spoiler_status: "spoiler-free"          # spoiler-free | contains-spoilers (only if the body has a spoiler section)
editorial_status: "sample"              # sample | approved — "approved" removes the Sample label
author: "Twisted Takes"                 # byline
date: 2026-10-18                        # publish date; future dates are hidden until that day
discussion_question: "A specific question about this movie that invites friendly disagreement."
related_reviews:                        # exactly two existing review slugs, each with a reason
  - slug: "inception"
    reason: "Why someone who likes this would like that."
  - slug: "arrival"
    reason: "A different connection."
sources:                                # optional factual sources (official pages preferred)
  - label: "Official film page"
    url: "https://example.com/replace-me"
trailer_url: null                       # optional official trailer URL; never guess one
---

## Premise

Two or three sentences of setup. No spoilers.

## The Take

Your opinion: what the film is doing and whether it works.

## What Works

Specific strengths: writing, performances, visuals, sound, pacing, themes.

## What May Divide Viewers

A specific tradeoff some viewers will not enjoy.

## Who Should Watch

The kind of viewer this suits.

<!--
Optional spoiler section. Keep the opening and closing tags exactly as shown,
set spoiler_status: "contains-spoilers" above, and delete this comment.

<details class="spoiler" markdown="1">
<summary>Spoiler section: the ending of Movie Title</summary>

Paragraphs about the ending go here.

</details>
-->
