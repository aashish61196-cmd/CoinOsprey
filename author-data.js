/* =============================================================
   COINOSPREY — AUTHOR REGISTRY
   =============================================================
   This is the single place where verified author information
   lives. It is intentionally separate from /api/articles because
   the current article API only stores the author's name as a
   plain string on each article — it has no bio, photo, role or
   social-link fields.

   HOW THIS WORKS
   - Key = the author's URL slug (used in author.html?slug=...).
   - "matchNames" = every exact string that appears in an
     article's "author" field for this person. This is how the
     page finds which articles belong to them. Add every variant
     you've used (e.g. with/without middle name).
   - Every field below is OPTIONAL except "matchNames". If a field
     is missing, author-page.js hides that part of the page instead
     of showing a placeholder or invented text.
   - Do NOT fill in bio, role, awards, employer history, or any
     other credential unless it is verified and approved by the
     site's editorial team. Leaving a field out is always safer
     than guessing.

   TO ADD A NEW AUTHOR
   Copy one entry below, change the slug/key, and fill in only the
   fields you can verify. No code changes or rebuild are required.
   ============================================================= */

window.CO_AUTHOR_REGISTRY = {

  /* ---------------------------------------------------------
     EXAMPLE / TEMPLATE ENTRY — copy this block for each author.
     Delete or leave unfilled fields out entirely; do not leave
     them as empty strings, since author-page.js checks for
     missing keys (not empty values) to decide what to hide.
     --------------------------------------------------------- */
  // "manish-prajapat": {
  //   name: "Manish Prajapat",
  //   matchNames: ["Manish Prajapat"],
  //   role: "Crypto News & Research Contributor",
  //   focus: "Cryptocurrency markets, blockchain developments and digital asset industry news.",
  //   bio: "Verified biography text approved by the editorial team goes here.",
  //   image: "/authors/manish-prajapat.jpg",
  //   expertise: ["Cryptocurrency", "Blockchain", "Market Research"],
  //   organization: "CoinOsprey",
  //   languages: "English",
  //   location: "",           // only include if intentionally public
  //   joined: "",             // e.g. "Jan 2025" — only if verified
  //   social: {
  //     twitter: "",
  //     linkedin: "",
  //     website: "",
  //     github: ""
  //   }
  // },

};

/* Fallback identity used on article pages when an author has no
   dedicated profile yet. Only used if it matches CoinOsprey's
   existing editorial structure — do not invent a profile instead. */
window.CO_UNKNOWN_AUTHOR_FALLBACK = "CoinOsprey Editorial Team";
