// The country list behind the country and continent pages, shared with Reach Check: src/regions.json is vendored,
// unchanged, from 1ms.dog's shell (`scripts/regions.mjs` there, regenerated monthly). The list and the ordering rules
// live there; this file only derives what the pages need from it, so a new copy is a drop-in replacement.
//
// 86 countries with at least 3 online probes, continents by probe count (EU, NA, AS, SA, OC, AF), and inside a
// continent by probe count. Russia is counted in Europe, as the shell's generator does.
import data from "./regions.json" with { type: "json" };
import notes from "./regions-notes.json" with { type: "json" };
import { countryName } from "./model.mjs";

export const DATA = data;

// The hand-written note on a country's networks, from the same shared source (shell commit fad44d6 at this copy).
// The file names languages "zh", "en", "zh-TW", "ja", "ko", "es", "fr" so far; a language it does not carry yet shows no note
// rather than an English one.
export const NOTES = notes;
const NOTE_LANG = { "zh-CN": "zh", en: "en", "zh-TW": "zh-TW", ja: "ja", ko: "ko", es: "es", fr: "fr" };
export const noteFor = (cc, lang) => {
  const key = NOTE_LANG[lang];
  return key && notes.notes[cc] && notes.notes[cc][key] ? notes.notes[cc][key] : "";
};

// the URL folder of each continent: English words, the same in every language (topic pages use one slug per page, so
// a page keeps one address and the language folders sit in front of it)
export const CONT_SLUG = { EU: "europe", NA: "north-america", AS: "asia", SA: "south-america", OC: "oceania", AF: "africa" };

export const CONTINENTS = data.continents.map(c => ({ ...c, slug: CONT_SLUG[c.code] || c.code.toLowerCase() }));

// one entry per country, with what its page needs; `i` is its position inside the continent (the list is already
// sorted by probe count)
const byCc = new Map();
for (const c of CONTINENTS) {
  c.countries = c.countries.map((x, i) => {
    const y = { ...x, cont: c.code, contSlug: c.slug, i, share: x.probes ? x.eyeball / x.probes : 0 };
    byCc.set(x.cc, y);
    return y;
  });
}
export const COUNTRIES = CONTINENTS.flatMap(c => c.countries);
export const countryByCc = cc => byCc.get(cc) || null;
export const countrySlug = cc => String(cc).toLowerCase();
// The English full name, for search: the short display name shortens some ("UK", "US") and would hide "United
// Kingdom" from a visitor typing it.
const EN_LONG = new Intl.DisplayNames(["en"], { type: "region", style: "long" });
export const englishName = cc => cc === "TW" ? "Taiwan, China" : (EN_LONG.of(cc) || countryName(cc, "en"));
// A country's page sits under its continent: /<lang>/europe/de/. Flat codes would collide with the language folders
// (/de/ is German, but DE is Germany), and the nesting gives the breadcrumb a real address.
export const countryDir = c => `${c.contSlug}/${countrySlug(c.cc)}`;

// The countries a continent page tests in one request: the ones with the most probes, at most five. Oceania has only
// two countries in the list, so it tests both rather than pads the list with countries from elsewhere.
export const picksOf = cont => cont.countries.slice(0, Math.min(5, cont.countries.length));

// "Main" countries for the sitemap priority: enough probes that a result means something. The shell's rule is
// continents 0.8, main countries 0.7, small ones 0.5.
export const isMain = c => c.probes >= 50;

// A country's neighbours for the "also in this continent" links: the two on either side in probe order, and the
// continent's page. The country itself is skipped.
export const neighboursOf = c => {
  const list = CONTINENTS.find(x => x.code === c.cont).countries;
  return [list[c.i - 2], list[c.i - 1], list[c.i + 1], list[c.i + 2]].filter(Boolean);
};

