import sources from "./sources.json" with { type: "json" };

// Every figure on the landing page, in its source's own words, with where those words were read. Each page was
// fetched and read on the day given, and the words found in it. No figure here is from memory.
// The list itself is lib/sources.json, so that scripts/check_sources.py can read it too: that script fetches every
// page again (two web pages and a PDF) and looks for the words. Run it before a submission.
export interface Source {
  about: string; // what the figure is about, in our own words, with no figure of our own
  asked?: string; // for a line from a table of survey answers: the question that was asked, unchanged
  quote: string; // the source's sentence, or its line of a table, unchanged
  who: string; // who says it, and when
  whom: string; // whom the figure describes, so it is not read more widely than it was meant
  url: string;
  read: string; // the day the page was read
}

export const SOURCES: Source[] = sources;
