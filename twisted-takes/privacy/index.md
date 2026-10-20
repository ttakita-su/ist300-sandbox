---
title: "Privacy notice"
permalink: /privacy/
description: "What the Twisted Takes website collects, which outside services it uses, and the choices you have."
lede: "Short version: we do not ask for your name, email or anything else about you."
---
{%- include analytics-status.html -%}
{%- assign form_url = site.community_form.url | default: "" | strip -%}

## Hosting

This website is a set of static pages hosted on [GitHub Pages](https://pages.github.com/). GitHub may keep technical logs, including visitors’ IP addresses, to keep its service secure. See the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Analytics

{% if tt_analytics_on -%}
We use Google Analytics 4 to understand how the site is used: which pages are read, how far people scroll, which outside links (such as our social profiles) are clicked, and how often the search, genre filters and share buttons are used. Google Analytics sets cookies in your browser to tell visits apart. We do not send names, email addresses or anything you type into a form to Google Analytics. A search term is only recorded when it matches something on this site.

You can learn how Google uses this information at [How Google uses information from sites that use its services](https://policies.google.com/technologies/partner-sites), and you can opt out with the [Google Analytics opt-out browser add-on](https://tools.google.com/dlpage/gaoptout) or your browser’s privacy settings.
{%- else -%}
This site does not use analytics, advertising or tracking cookies.
{%- endif %}

## Search, filters and sharing

Search, filters and sorting run entirely in your browser. The “Copy link” button only copies this page’s address to your clipboard. Nothing you type into the search box is sent to us{% if tt_analytics_on %}, apart from the analytics event described above{% endif %}.

## Links to social platforms

Links to Instagram, TikTok and YouTube take you to those services, which have their own privacy policies.

{% if form_url != "" -%}
## Community form

Our optional poll and recommendation form is run by {{ site.community_form.provider | default: "an outside service" }}. Anything you submit goes to that service under its own privacy terms; this website never sees it.
{%- endif %}

{% if site.privacy.contact and site.privacy.contact != "" -%}
## Contact

Questions about this notice: {{ site.privacy.contact }}
{%- endif %}

{% if site.privacy.extra_note and site.privacy.extra_note != "" -%}
{{ site.privacy.extra_note }}
{%- endif %}
